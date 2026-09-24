"use strict";

const { createAntigravityOperation } = require("./antigravityOperation");
const { computeSttBudgetMs } = require("./antigravityFailover");

const CLEANUP_BUDGET_MS = 30_000;
const CHAT_TOOL_BUDGET_MS = 30_000;

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

function toolTurnBudgetMs(payload = {}) {
  return Number(payload.timeoutMs) > 0 ? payload.timeoutMs : CHAT_TOOL_BUDGET_MS;
}

module.exports = {
  antigravityPrefsFromPayload,
  beginAntigravityOperation,
  sttBudgetFromPayload,
  cleanupBudgetMs,
  toolTurnBudgetMs,
};
