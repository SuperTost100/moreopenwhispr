const fs = require("fs");
const os = require("os");
const path = require("path");
const { DEFAULT_ANTIGRAVITY_MODEL, ensureWritableDir, runAgyTurn } = require("./antigravityCli");
const { getAntigravityAccessToken } = require("./antigravityAuth");
const {
  generateTextViaGateway,
  getAntigravityProjectId,
  DAILY_CLOUDCODE_BASE,
} = require("./antigravityGateway");
const {
  getCatalog,
  notifyModelUnavailable,
  resolveAntigravityModels,
  emptyCandidatesError,
} = require("./antigravityModelCatalog");
const {
  decideAntigravityFailover,
  applyFailoverSideEffects,
  isNetworkUnreachableError,
} = require("./antigravityFailover");
const { createAntigravityError } = require("./antigravityOperation");

const TOOL_LOOP_JSON_SCHEMA = {
  type: "object",
  properties: {
    type: { enum: ["tool_call", "final"] },
    tool_call: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object" },
      },
    },
    content: { type: "string" },
  },
  required: ["type"],
};

function buildReasoningPrompt({ systemPrompt, userText }) {
  return [
    "SYSTEM:",
    systemPrompt,
    "",
    "USER:",
    userText,
    "",
    "Follow the OUTPUT RULES in the system prompt above. Output only the answer.",
  ].join("\n");
}

function extensionForMediaType(mediaType) {
  if (mediaType === "image/png") {
    return ".png";
  }
  return ".jpg";
}

function stripMarkdownFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json|text)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function coerceToolLoopPayload(parsed) {
  if (parsed?.type === "tool_call" || parsed?.type === "final") {
    // Spike quirk: model sometimes marks type=final but puts the tool call JSON in content.
    if (parsed.type === "final" && typeof parsed.content === "string") {
      const nested = stripMarkdownFences(parsed.content);
      if (nested.startsWith("{")) {
        try {
          const inner = JSON.parse(nested);
          if (typeof inner?.name === "string") {
            return {
              type: "tool_call",
              tool_call: {
                name: inner.name,
                arguments:
                  inner.arguments && typeof inner.arguments === "object" ? inner.arguments : {},
              },
            };
          }
        } catch {
          // keep as final
        }
      }
    }
    return parsed;
  }
  if (typeof parsed?.name === "string") {
    return {
      type: "tool_call",
      tool_call: {
        name: parsed.name,
        arguments: parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : {},
      },
    };
  }
  throw new Error("Invalid tool loop response type");
}

function parseToolLoopResponse(text) {
  const cleaned = stripMarkdownFences(text);
  let parsed = JSON.parse(cleaned);
  // Unwrap agy --output-format json envelope if present.
  if (parsed?.structured_output != null && parsed.type !== "tool_call" && parsed.type !== "final") {
    parsed =
      typeof parsed.structured_output === "string"
        ? JSON.parse(stripMarkdownFences(parsed.structured_output))
        : parsed.structured_output;
  }
  return coerceToolLoopPayload(parsed);
}

function formatMessagesForPrompt(messages = []) {
  return messages
    .map((message, index) => {
      const role = message?.role || "user";
      const content = message?.content || "";
      return `[${index + 1}] ${role.toUpperCase()}:\n${content}`;
    })
    .join("\n\n");
}

function formatToolsForPrompt(tools = []) {
  return tools
    .map((tool) => {
      const name = tool?.name || tool?.function?.name || "unknown_tool";
      const description = tool?.description || tool?.function?.description || "";
      return `- ${name}: ${description}`.trim();
    })
    .join("\n");
}

function buildToolLoopPrompt({ systemPrompt, messages, tools }) {
  return [
    "SYSTEM:",
    systemPrompt,
    "",
    "Available tools:",
    formatToolsForPrompt(tools),
    "",
    "Conversation:",
    formatMessagesForPrompt(messages),
    "",
    "Respond with JSON matching the provided schema.",
    'Use type "tool_call" with tool_call.name/arguments, or type "final" with content.',
  ].join("\n");
}

async function reasonWithAntigravityGateway({
  text,
  systemPrompt,
  fetchImpl,
  getAccessToken,
  getProjectId,
  op,
  antigravityPrefs,
  command,
}) {
  const prefs = {
    cleanup:
      typeof antigravityPrefs?.cleanup === "string" && antigravityPrefs.cleanup.trim()
        ? antigravityPrefs.cleanup.trim()
        : "auto",
  };
  const resolved = resolveAntigravityModels(getCatalog(), prefs);
  const candidates =
    resolved.candidates.cleanup?.length > 0
      ? resolved.candidates.cleanup
      : [resolved.cleanup].filter(Boolean);
  if (candidates.length === 0) {
    throw emptyCandidatesError(resolved, "cleanup");
  }
  let auth = await getAccessToken({ signal: op?.signal, op });
  let authRetried = false;
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const gatewayModel = candidates[index];
    op?.throwIfDone?.();
    try {
      const projectId = await getProjectId({
        accessToken: auth.accessToken,
        accountKey: auth.accountKey,
        fetchImpl,
        op,
      });
      return {
        text: await generateTextViaGateway({
          accessToken: auth.accessToken,
          accountKey: auth.accountKey,
          projectId,
          model: gatewayModel,
          systemPrompt,
          userText: text,
          fetchImpl,
          gatewayBase: DAILY_CLOUDCODE_BASE,
          op,
        }),
        notices: resolved.notices,
      };
    } catch (error) {
      lastError = error;
      const decision = decideAntigravityFailover(error, {
        slot: "cleanup",
        remainingMs: op?.remainingMs?.() ?? 0,
        budgetExhausted: (op?.remainingMs?.() ?? 0) <= 0,
        authRetried,
      });
      if (decision.action === "retry_auth") {
        authRetried = true;
        auth = await getAccessToken({ signal: op?.signal, op, forceRefresh: true });
        index -= 1;
        continue;
      }
      if (decision.refreshCatalog) notifyModelUnavailable();
      applyFailoverSideEffects(decision, gatewayModel);
      if (decision.action === "failover") continue;
      if (decision.action === "subprocess") {
        const prompt = buildReasoningPrompt({ systemPrompt, userText: text });
        const turn = await runAgyTurn({
          prompt,
          model: undefined,
          cwd: process.cwd(),
          command,
          printTimeout: "120s",
          timeoutMs: Math.min(180_000, op?.remainingMs?.() || 180_000),
          extraArgs: ["--sandbox"],
          signal: op?.signal,
        });
        return { text: turn.text.trim(), notices: resolved.notices };
      }
      throw error;
    }
  }

  if (lastError && isNetworkUnreachableError(lastError) && (op?.remainingMs?.() ?? 0) > 8_000) {
    const prompt = buildReasoningPrompt({ systemPrompt, userText: text });
    const turn = await runAgyTurn({
      prompt,
      model: undefined,
      cwd: process.cwd(),
      printTimeout: "120s",
      timeoutMs: Math.min(180_000, op?.remainingMs?.() || 180_000),
      extraArgs: ["--sandbox"],
      signal: op?.signal,
    });
    return { text: turn.text.trim(), notices: resolved.notices };
  }

  throw lastError || createAntigravityError("AGY_HTTP", "Antigravity cleanup failed");
}

async function reasonWithAntigravity({
  text,
  model,
  systemPrompt,
  screenContext,
  command,
  runTurn = runAgyTurn,
  tmpRoot = os.tmpdir(),
  fetchImpl = fetch,
  getAccessToken = getAntigravityAccessToken,
  getProjectId = getAntigravityProjectId,
  op,
  antigravityPrefs,
}) {
  const resolvedModel = model || DEFAULT_ANTIGRAVITY_MODEL;

  if (screenContext?.data) {
    let userText = text;
    const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "openwhispr-antigravity-llm-"));
    ensureWritableDir(tmpDir);
    const addDirs = [tmpDir];
    const mediaType = screenContext.mediaType || "image/jpeg";
    const imagePath = path.join(tmpDir, `screen${extensionForMediaType(mediaType)}`);
    fs.writeFileSync(imagePath, Buffer.from(screenContext.data, "base64"));
    userText = `${text}\n\nAttached screenshot path: ${path.basename(imagePath)}`;
    try {
      const prompt = buildReasoningPrompt({ systemPrompt, userText });
      const turn = await runTurn({
        prompt,
        model: resolvedModel,
        addDirs,
        cwd: tmpDir,
        command,
        printTimeout: "120s",
        // Bound by the request: a cancel or an exhausted budget has to stop
        // the agy child too, not leave it running for up to three minutes.
        // The 1ms floor matters because 0 means "no timeout" to runAgyTurn.
        timeoutMs: Math.max(1, Math.min(180_000, op?.remainingMs?.() ?? 180_000)),
        ...(op?.signal ? { signal: op.signal } : {}),
        extraArgs: ["--sandbox"],
      });
      return turn.text.trim();
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  const { text: answer } = await reasonWithAntigravityGateway({
    text,
    systemPrompt,
    fetchImpl,
    getAccessToken,
    getProjectId,
    op,
    antigravityPrefs: {
      cleanup:
        typeof antigravityPrefs?.cleanup === "string"
          ? antigravityPrefs.cleanup
          : typeof model === "string" && model.trim() && !model.startsWith("gemini-3.5-transcribe")
            ? model
            : "auto",
    },
    command,
  });
  return answer;
}

async function runToolLoopTurn({
  systemPrompt,
  messages,
  tools,
  model,
  command,
  runTurn = runAgyTurn,
  cwd = process.cwd(),
  timeoutMs,
  conversationId,
  extraArgs = ["--sandbox"],
  printTimeout = "120s",
  signal,
}) {
  const prompt = buildToolLoopPrompt({ systemPrompt, messages, tools });
  const turn = await runTurn({
    prompt,
    model: model || DEFAULT_ANTIGRAVITY_MODEL,
    cwd,
    command,
    timeoutMs,
    conversationId,
    jsonSchema: TOOL_LOOP_JSON_SCHEMA,
    outputFormat: "json",
    printTimeout,
    extraArgs,
    signal,
  });
  const result = parseToolLoopResponse(turn.text);
  const nextConversationId =
    typeof turn.envelope?.conversation_id === "string" && turn.envelope.conversation_id.trim()
      ? turn.envelope.conversation_id.trim()
      : conversationId || null;
  return { result, conversationId: nextConversationId };
}

module.exports = {
  buildReasoningPrompt,
  reasonWithAntigravity,
  runToolLoopTurn,
  parseToolLoopResponse,
  TOOL_LOOP_JSON_SCHEMA,
};
