"use strict";

const { createAntigravityOperation } = require("./antigravityOperation");
const { computeSttBudgetMs } = require("./antigravityFailover");

const CLEANUP_BUDGET_MS = 30_000;
// Phase B: one gateway call per chat turn instead of a 10-30s agy subprocess
// print, so the per-turn budget widens to 60s (vs. the old 30s CLI budget)
// to cover a cold gateway request + a candidate failover hop within it.
const CHAT_TURN_BUDGET_MS = 60_000;

function antigravityPrefsFromPayload(payload = {}) {
  const prefs = payload.antigravityPrefs || {};
  return {
    stt: payload.antigravitySttModel || prefs.stt || "auto",
    cleanup: payload.antigravityCleanupModel || prefs.cleanup || "auto",
    chat: payload.antigravityChatModel || prefs.chat || "auto",
  };
}

// Chat-turn-specific prefs: an explicit model pick sent with this turn (the
// renderer's already-resolved chat model, e.g. from antigravityChat.ts)
// takes precedence over the antigravityChatModel setting, which in turn
// takes precedence over "auto". antigravityPrefsFromPayload alone only
// reads antigravityChatModel / antigravityPrefs.chat, neither of which the
// chat-turn caller supplies, so without this every tool-enabled chat
// resolved as "auto" regardless of the model the user picked in the UI.
function chatPrefsFromPayload(payload = {}) {
  const prefs = antigravityPrefsFromPayload(payload);
  if (typeof payload?.model === "string" && payload.model.trim()) {
    prefs.chat = payload.model.trim();
  }
  return prefs;
}

function beginAntigravityOperation(registry, event, payload, { budgetMs, label }) {
  const requestId =
    typeof payload?.requestId === "string" && payload.requestId.trim()
      ? payload.requestId.trim()
      : require("crypto").randomUUID();
  const controller = registry.begin(event.sender.id, requestId);
  const op = createAntigravityOperation({
    budgetMs,
    signal: controller.signal,
    label,
  });
  return { op, controller, requestId };
}

function sttBudgetFromPayload(payload = {}) {
  return computeSttBudgetMs({ audioDurationSec: payload.audioDurationSec });
}

function cleanupBudgetMs() {
  return CLEANUP_BUDGET_MS;
}

const STATUS_CHECK_BUDGET_MS = 8_000;

/**
 * getAntigravityStatus({ resolveBinary, getAccessToken }) ->
 *   { state: "missing" | "signedOut" | "signedIn" | "unknown", code? }
 *
 * What Settings shows next to the Antigravity provider. Finding the agy
 * binary says nothing about whether the user ran `agy auth login`, so this
 * also reads (and if needed refreshes) the token the way a dictation would.
 * Anything other than a missing binary or a dead sign-in (network down,
 * timeout) is "unknown" rather than a false "signed out".
 */
async function getAntigravityStatus({
  resolveBinary,
  getAccessToken,
  budgetMs = STATUS_CHECK_BUDGET_MS,
}) {
  try {
    resolveBinary();
  } catch {
    return { state: "missing" };
  }
  const op = createAntigravityOperation({ budgetMs, label: "antigravity-status" });
  try {
    await getAccessToken({ op });
    return { state: "signedIn" };
  } catch (error) {
    if (error?.code === "AGY_AUTH_REQUIRED") return { state: "signedOut" };
    return { state: "unknown", code: error?.code };
  }
}

function chatTurnBudgetMs(payload = {}) {
  return Number(payload.timeoutMs) > 0 ? payload.timeoutMs : CHAT_TURN_BUDGET_MS;
}

module.exports = {
  antigravityPrefsFromPayload,
  chatPrefsFromPayload,
  beginAntigravityOperation,
  sttBudgetFromPayload,
  cleanupBudgetMs,
  chatTurnBudgetMs,
  getAntigravityStatus,
};
