import type { AgentStreamChunk } from "../ReasoningService";
import type { ScreenContextImage } from "../../types/electron";

// Phase B: the assistant tool loop now spends one gateway streamGenerateContent
// call per turn (native Gemini function calling) instead of spawning
// `agy --print` per turn (10-30s). This module owns the multi-turn loop:
// execute the calls a turn returns, append functionResponse parts, and ask
// the main process for another turn until the model answers with text only.
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

export type GeminiPart = Record<string, unknown> & {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  inlineData?: { mimeType: string; data: string };
  thoughtSignature?: string;
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

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

/**
 * buildInitialContents(messages, screenContext) -> GeminiContent[]
 *
 * Converts the caller's plain user/assistant text history into Gemini
 * `contents` (assistant -> "model"), and — per the goal — attaches a
 * captured screenshot as an `inlineData` part on the first user turn (or, if
 * there is no prior user turn yet, as its own leading user turn).
 */
export function buildInitialContents(
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>,
  screenContext?: ScreenContextImage | null
): GeminiContent[] {
  const conversation = chatMessagesFromHistory(messages);
  const contents: GeminiContent[] = conversation.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  if (screenContext?.data) {
    const imagePart: GeminiPart = {
      inlineData: { mimeType: screenContext.mediaType || "image/jpeg", data: screenContext.data },
    };
    const firstUserIndex = contents.findIndex((c) => c.role === "user");
    if (firstUserIndex >= 0) {
      contents[firstUserIndex] = {
        ...contents[firstUserIndex],
        parts: [...contents[firstUserIndex].parts, imagePart],
      };
    } else {
      contents.push({ role: "user", parts: [imagePart] });
    }
  }

  return contents;
}

function matchesJsonSchemaType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true; // unknown/unsupported schema type keyword: don't block on it
  }
}

/**
 * validateToolArguments(schema, args) -> required-field + type check against
 * a tool's JSON Schema `parameters`, run before executing a returned call.
 * Never throws — a malformed schema is treated as "nothing to check".
 */
export function validateToolArguments(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (!schema || typeof schema !== "object") return { valid: true };
  const safeArgs = args && typeof args === "object" ? args : {};

  const required = Array.isArray((schema as { required?: unknown }).required)
    ? ((schema as { required: unknown[] }).required.filter((k) => typeof k === "string") as string[])
    : [];
  for (const key of required) {
    if (!(key in safeArgs)) {
      return { valid: false, error: `Missing required argument: ${key}` };
    }
  }

  const properties = (schema as { properties?: unknown }).properties;
  if (properties && typeof properties === "object") {
    for (const [key, value] of Object.entries(safeArgs)) {
      const propSchema = (properties as Record<string, unknown>)[key];
      if (!propSchema || typeof propSchema !== "object") continue;
      const expectedType = (propSchema as { type?: unknown }).type;
      if (typeof expectedType !== "string") continue;
      if (!matchesJsonSchemaType(value, expectedType)) {
        return {
          valid: false,
          error: `Argument "${key}" expected type ${expectedType}, got ${typeof value}`,
        };
      }
    }
  }

  return { valid: true };
}

/** Stable (key-sorted) JSON encoding, so arg order never breaks the dedupe hash. */
function stableArgsKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableArgsKey).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableArgsKey(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** dedupeKeyForCall(call) -> the call's own `id` when present, else a name+args hash. */
export function dedupeKeyForCall(call: { name: string; args: Record<string, unknown>; id?: string }): string {
  return call.id || `${call.name}:${stableArgsKey(call.args || {})}`;
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
  if (!api?.processAntigravityChatTurn) {
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

  let contents = buildInitialContents(messages, resolvedScreenContext);
  const schemaByName = new Map(tools.map((tool) => [tool.name, tool.parameters]));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (abortSignal?.aborted) return;

    const response = await api.processAntigravityChatTurn({
      systemPrompt,
      contents,
      tools,
      model,
      timeoutMs: 60_000,
    });

    if (!response.success) {
      throw new Error(response.error || "Antigravity chat turn failed");
    }

    const textParts = response.textParts || [];
    const functionCalls = response.functionCalls || [];

    if (functionCalls.length === 0) {
      const text = textParts
        .map((p) => p.text)
        .join("")
        .trim();
      if (text) yield { type: "content", text };
      yield { type: "done", finishReason: "stop" };
      return;
    }

    if (!executeToolCall) {
      throw new Error(`Tool ${functionCalls[0].name} requested but no executor configured`);
    }

    // Keep the model's turn (any text plus every functionCall it made) in
    // history verbatim, thoughtSignature included — Gemini 3 requires it
    // echoed back on the follow-up request.
    const modelParts: GeminiPart[] = [
      ...textParts.map((p) =>
        p.thoughtSignature ? { text: p.text, thoughtSignature: p.thoughtSignature } : { text: p.text }
      ),
      ...functionCalls.map((call) => ({
        functionCall: { name: call.name, args: call.args, ...(call.id ? { id: call.id } : {}) },
        ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
      })),
    ];
    contents = [...contents, { role: "model", parts: modelParts }];

    const functionResponseParts: GeminiPart[] = [];
    const seenKeys = new Set<string>();

    for (const call of functionCalls) {
      const key = dedupeKeyForCall(call);
      const withId = (response: Record<string, unknown>): GeminiPart => ({
        functionResponse: { name: call.name, response, ...(call.id ? { id: call.id } : {}) },
      });

      if (seenKeys.has(key)) {
        functionResponseParts.push(withId({ error: "Duplicate call skipped" }));
        continue;
      }
      seenKeys.add(key);

      const validation = validateToolArguments(schemaByName.get(call.name), call.args);
      if (!validation.valid) {
        functionResponseParts.push(withId({ error: validation.error }));
        continue;
      }

      if (abortSignal?.aborted) return;

      const callId = call.id || crypto.randomUUID();
      const argsJson = JSON.stringify(call.args ?? {});
      yield { type: "tool_calls", calls: [{ id: callId, name: call.name, arguments: argsJson }] };

      try {
        const toolResult = await executeToolCall(call.name, argsJson);
        yield {
          type: "tool_result",
          callId,
          toolName: call.name,
          displayText: toolResult.displayText,
          metadata: toolResult.metadata,
        };
        functionResponseParts.push(withId({ result: toolResult.data }));
      } catch (error) {
        functionResponseParts.push(
          withId({ error: error instanceof Error ? error.message : String(error) })
        );
      }
    }

    contents = [...contents, { role: "user", parts: functionResponseParts }];
  }

  throw new Error("Antigravity tool loop exceeded maximum turns");
}
