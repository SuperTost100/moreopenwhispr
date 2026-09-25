// Phase B: the assistant chat tool loop, backed by the gateway instead of
// spawning `agy --print` for every turn (the old path was 10-30s/turn; the
// gateway is 1-4s warm). One call here == one streamGenerateContent request
// carrying the full structured history and native Gemini functionDeclarations;
// the renderer (src/services/ai/antigravityChat.ts) owns the multi-call loop
// (execute tool calls, append functionResponse parts, call again) and only
// asks this module for one turn at a time.
//
// Failover mirrors reasonWithAntigravityGateway in antigravityReasoning.js:
// walk the chat-slot candidate models within the operation budget, retry
// once on a 401, and fall back to the agy CLI subprocess only when the
// gateway itself is unreachable and budget remains (never on quota
// exhaustion, never passing a gateway model id to the CLI — agy picks its
// own current default).
"use strict";

const debugLogger = require("./debugLogger");
const { getAntigravityAccessToken } = require("./antigravityAuth");
const {
  streamChatTurn,
  getAntigravityProjectId,
  DAILY_CLOUDCODE_BASE,
} = require("./antigravityGateway");
const {
  getCatalog,
  notifyModelUnavailable,
  resolveAntigravityModels,
} = require("./antigravityModelCatalog");
const {
  decideAntigravityFailover,
  applyFailoverSideEffects,
  isNetworkUnreachableError,
} = require("./antigravityFailover");
const { createAntigravityError } = require("./antigravityOperation");
const { buildFunctionDeclarations, flattenGeminiContentsToMessages } = require(
  "./antigravityFunctionCalling"
);
const { runToolLoopTurn } = require("./antigravityReasoning");

/**
 * Drops `inlineData` parts (the screen-context screenshot) when the chosen
 * model's catalog entry doesn't advertise `supportsImages`. Never fails the
 * turn — only logs a boolean, per the screen-context privacy rule (no image
 * bytes, no message content in logs).
 */
function stripUnsupportedImages(contents, supportsImages) {
  if (supportsImages) return contents;
  let dropped = false;
  const next = contents.map((turn) => {
    if (!Array.isArray(turn?.parts)) return turn;
    const kept = turn.parts.filter((part) => {
      if (part?.inlineData) {
        dropped = true;
        return false;
      }
      return true;
    });
    if (kept.length === turn.parts.length) return turn;
    return { ...turn, parts: kept };
  });
  if (dropped) {
    debugLogger.info(
      "Antigravity chat turn dropped screen context image: model lacks supportsImages",
      { hasScreenContext: true, attached: false },
      "antigravity"
    );
  }
  return next;
}

async function subprocessChatTurn({ systemPrompt, contents, tools, op, command }) {
  const messages = flattenGeminiContentsToMessages(contents);
  const { result } = await runToolLoopTurn({
    systemPrompt,
    messages,
    tools,
    model: undefined, // never pin a gateway model id on the CLI path
    command,
    timeoutMs: Math.min(180_000, op?.remainingMs?.() || 180_000),
    signal: op?.signal,
  });
  if (result?.type === "tool_call" && result.tool_call) {
    return {
      textParts: [],
      functionCalls: [
        {
          name: result.tool_call.name,
          args:
            result.tool_call.arguments && typeof result.tool_call.arguments === "object"
              ? result.tool_call.arguments
              : {},
        },
      ],
      finishReason: "STOP",
    };
  }
  const text = typeof result?.content === "string" ? result.content.trim() : "";
  return {
    textParts: text ? [{ text }] : [],
    functionCalls: [],
    finishReason: "STOP",
  };
}

/**
 * runAntigravityChatTurn({ systemPrompt, contents, tools, op, antigravityPrefs, ... })
 *   -> Promise<{ textParts, functionCalls, finishReason, notices }>
 *
 * `contents` is already in Gemini shape (built by the renderer loop); `tools`
 * is the app's JSON-Schema tool list, converted here to functionDeclarations.
 */
async function runAntigravityChatTurn({
  systemPrompt,
  contents,
  tools = [],
  fetchImpl = fetch,
  getAccessToken = getAntigravityAccessToken,
  getProjectId = getAntigravityProjectId,
  gatewayBase = DAILY_CLOUDCODE_BASE,
  op,
  antigravityPrefs,
  command,
}) {
  const prefs = {
    chat:
      typeof antigravityPrefs?.chat === "string" && antigravityPrefs.chat.trim()
        ? antigravityPrefs.chat.trim()
        : "auto",
  };
  const resolved = resolveAntigravityModels(getCatalog(), prefs);
  const candidates =
    resolved.candidates.chat?.length > 0 ? resolved.candidates.chat : [resolved.chat].filter(Boolean);
  const functionDeclarations = buildFunctionDeclarations(tools);
  const systemInstruction = systemPrompt?.trim() ? { parts: [{ text: systemPrompt.trim() }] } : undefined;

  let auth = await getAccessToken({ signal: op?.signal });
  let authRetried = false;
  let lastError = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const gatewayModel = candidates[index];
    op?.throwIfDone?.();
    try {
      const catalogEntry = getCatalog()?.models?.[gatewayModel];
      const preparedContents = stripUnsupportedImages(contents, catalogEntry?.supportsImages === true);
      const projectId = await getProjectId({
        accessToken: auth.accessToken,
        accountKey: auth.accountKey,
        fetchImpl,
        base: gatewayBase,
        op,
      });
      const { textParts, functionCalls, finishReason } = await streamChatTurn({
        accessToken: auth.accessToken,
        base: gatewayBase,
        projectId,
        model: gatewayModel,
        systemInstruction,
        contents: preparedContents,
        functionDeclarations,
        thinkingLevel: "low",
        fetchImpl,
        op,
        stageMs: op?.remainingMs?.(),
      });
      return { textParts, functionCalls, finishReason, notices: resolved.notices };
    } catch (error) {
      lastError = error;
      const decision = decideAntigravityFailover(error, {
        slot: "chat",
        remainingMs: op?.remainingMs?.() ?? 0,
        budgetExhausted: (op?.remainingMs?.() ?? 0) <= 0,
        authRetried,
      });
      if (decision.action === "retry_auth") {
        authRetried = true;
        auth = await getAccessToken({ signal: op?.signal, forceRefresh: true });
        index -= 1;
        continue;
      }
      if (decision.refreshCatalog) notifyModelUnavailable();
      applyFailoverSideEffects(decision, gatewayModel);
      if (decision.action === "failover") continue;
      if (decision.action === "subprocess") {
        const turn = await subprocessChatTurn({ systemPrompt, contents, tools, op, command });
        return { ...turn, notices: resolved.notices };
      }
      throw error;
    }
  }

  if (lastError && isNetworkUnreachableError(lastError) && (op?.remainingMs?.() ?? 0) > 8_000) {
    const turn = await subprocessChatTurn({ systemPrompt, contents, tools, op, command });
    return { ...turn, notices: resolved.notices };
  }

  throw lastError || createAntigravityError("AGY_HTTP", "Antigravity chat turn failed");
}

module.exports = {
  runAntigravityChatTurn,
  stripUnsupportedImages,
};
