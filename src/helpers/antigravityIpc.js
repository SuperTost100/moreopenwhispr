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

function chatTurnBudgetMs(payload = {}) {
  return Number(payload.timeoutMs) > 0 ? payload.timeoutMs : CHAT_TURN_BUDGET_MS;
}

module.exports = {
  antigravityPrefsFromPayload,
  beginAntigravityOperation,
  sttBudgetFromPayload,
  cleanupBudgetMs,
  chatTurnBudgetMs,
};
