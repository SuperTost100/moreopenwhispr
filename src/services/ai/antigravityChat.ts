import type { AgentStreamChunk } from "../ReasoningService";
import type { ScreenContextImage } from "../../types/electron";

const MAX_TURNS = 8;

export type AntigravityToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AntigravityToolExecutionResult = {
  data: string;
  displayText: string;
  metadata?: Record<string, unknown> | Array<Record<string, unknown>>;
};

type ChatMessage = { role: string; content: string };

function chatMessagesFromHistory(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
): ChatMessage[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : (m.content as Array<{ type?: string; text?: string }>)
              .filter((p) => p.type === "text" && p.text)
              .map((p) => p.text!)
              .join("\n"),
    }))
    .filter((m) => m.content);
}

function screenContextFromMessages(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>
): ScreenContextImage | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = messages[i]?.content;
    if (!Array.isArray(content)) continue;
    const imagePart = content.find(
      (part) =>
        part &&
        typeof part === "object" &&
        (part.type === "image" || typeof (part as { image?: string }).image === "string")
    ) as { image?: string; mediaType?: string } | undefined;
    if (imagePart?.image) {
      return {
        data: imagePart.image,
        mediaType: imagePart.mediaType || "image/jpeg",
      };
    }
  }
  return null;
}

export async function* runAntigravityChatStream({
  systemPrompt,
  messages,
  tools,
  model,
  executeToolCall,
  abortSignal,
  screenContext,
}: {
  systemPrompt: string;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  tools: AntigravityToolSchema[];
  model: string;
  executeToolCall?: (name: string, argsJson: string) => Promise<AntigravityToolExecutionResult>;
  abortSignal?: AbortSignal;
  screenContext?: ScreenContextImage | null;
}): AsyncGenerator<AgentStreamChunk, void, unknown> {
  const api = window.electronAPI;
  if (!api?.processAntigravityToolTurn) {
    throw new Error("Antigravity chat is not available in this environment");
  }

  const resolvedScreenContext = screenContext || screenContextFromMessages(messages);

  if (!tools.length) {
    const conversation = chatMessagesFromHistory(messages);
    const lastUser = conversation.filter((m) => m.role === "user").pop();
    const userText = lastUser?.content || "";
    if (!api.processAntigravityReasoning) {
      throw new Error("Antigravity reasoning is not available in this environment");
    }
    const result = await api.processAntigravityReasoning(userText, model, null, {
      systemPrompt,
      ...(resolvedScreenContext ? { screenContext: resolvedScreenContext } : {}),
    });
    if (!result.success) {
      throw new Error(result.error || "Antigravity reasoning failed");
    }
    const text = (result.text || "").trim();
    if (text) yield { type: "content", text };
    yield { type: "done", finishReason: "stop" };
    return;
  }

  let conversation: ChatMessage[] = chatMessagesFromHistory(messages);
  if (resolvedScreenContext) {
    // Tool-loop turns are text-only over JSON schema; ground the first user turn
    // with a note that the screenshot was captured with the request (main-process
    // multimodal attach is reserved for the no-tools reasoning path).
    conversation = [
      ...conversation,
      {
        role: "user",
        content:
          "[Screen context was attached to this request. Use it if the question refers to what is on screen.]",
      },
    ];
  }
  let conversationId: string | undefined;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (abortSignal?.aborted) return;

    const response = await api.processAntigravityToolTurn({
      systemPrompt,
      messages: conversation,
      tools,
      model,
      conversationId,
      timeoutMs: 180_000,
    });

    if (!response.success) {
      throw new Error(response.error || "Antigravity tool turn failed");
    }

    if (typeof response.conversationId === "string" && response.conversationId.trim()) {
      conversationId = response.conversationId.trim();
    }

    const parsed = response.result as {
      type: string;
      content?: string;
      tool_call?: { name: string; arguments: Record<string, unknown> };
    };

    if (parsed?.type === "final") {
      const text = (parsed.content || "").trim();
      if (text) yield { type: "content", text };
      yield { type: "done", finishReason: "stop" };
      return;
    }

    if (parsed?.type === "tool_call" && parsed.tool_call) {
      if (!executeToolCall) {
        throw new Error(`Tool ${parsed.tool_call.name} requested but no executor configured`);
      }
      const { name, arguments: args } = parsed.tool_call;
      const callId = crypto.randomUUID();
      const argsJson = JSON.stringify(args ?? {});
      yield {
        type: "tool_calls",
        calls: [{ id: callId, name, arguments: argsJson }],
      };

      const toolResult = await executeToolCall(name, argsJson);
      yield {
        type: "tool_result",
        callId,
        toolName: name,
        displayText: toolResult.displayText,
        metadata: toolResult.metadata,
      };

      conversation = [
        ...conversation,
        {
          role: "assistant",
          content: JSON.stringify({ type: "tool_call", tool_call: parsed.tool_call }),
        },
        { role: "user", content: `Tool result for ${name}: ${toolResult.data}` },
      ];
      continue;
    }

    throw new Error("Invalid Antigravity tool loop response");
  }

  throw new Error("Antigravity tool loop exceeded maximum turns");
}
