"use strict";

const { markModelCooldown } = require("./antigravityModelCatalog");

const SUBPROCESS_MIN_REMAINING_MS = 8_000;
const MODEL_COOLDOWN_DEFAULT_MS = 10 * 60 * 1000;

function computeSttBudgetMs({ audioDurationSec } = {}) {
  const sec = Number.isFinite(audioDurationSec) && audioDurationSec > 0 ? audioDurationSec : 30;
  return Math.min(90_000, 12_000 + Math.round(sec * 500));
}

// While other candidates are still queued, one attempt may use only part of
// the remaining budget, so a model that stalls leaves time to fail over.
const ATTEMPT_BUDGET_SHARE = 0.6;
const ATTEMPT_MIN_MS = 4_000;

function attemptStageMs(remainingMs, candidatesLeft) {
  const remaining = Math.max(0, Number(remainingMs) || 0);
  if (!(candidatesLeft > 1)) return remaining;
  return Math.min(
    remaining,
    Math.max(ATTEMPT_MIN_MS, Math.round(remaining * ATTEMPT_BUDGET_SHARE))
  );
}

function isNetworkUnreachableError(error) {
  if (!error) return false;
  const code = error.code;
  if (
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN"
  ) {
    return true;
  }
  if (
    error.name === "TypeError" &&
    /fetch failed|network|ECONN/i.test(String(error.message || ""))
  ) {
    return true;
  }
  return false;
}

/**
 * Pure failover policy (A5). Returns what to do after a failed gateway attempt.
 * @returns {{ action: 'failover'|'stop'|'retry_auth'|'subprocess', error?: Error, cooldownMs?: number, refreshCatalog?: boolean }}
 */
function decideAntigravityFailover(error, context = {}) {
  const code = error?.code;
  const slot = context.slot || "stt";
  const hadSpeech = context.hadSpeech !== false;
  const budgetExhausted = Boolean(context.budgetExhausted);
  const remainingMs = Number(context.remainingMs) || 0;
  const authRetried = Boolean(context.authRetried);

  if (code === "AGY_CANCELLED" || code === "AGY_AUTH_REQUIRED" || code === "AGY_BLOCKED") {
    return { action: "stop", error };
  }

  if (code === "AGY_RATE_LIMITED") {
    if (error.scope === "account") return { action: "stop", error };
    return {
      action: "failover",
      error,
      cooldownMs: Number.isFinite(error.retryAfterMs)
        ? error.retryAfterMs
        : MODEL_COOLDOWN_DEFAULT_MS,
    };
  }

  if (code === "AGY_TIMEOUT") {
    if (budgetExhausted) return { action: "stop", error };
    return { action: "failover", error };
  }

  if (code === "AGY_MODEL_UNAVAILABLE") {
    return { action: "failover", error, refreshCatalog: true };
  }

  // A stream that parsed real content but never reached a terminal
  // finishReason (premature EOF / dropped connection) — treat like any
  // other stage failure and let the next candidate model retry.
  if (code === "AGY_TRUNCATED") {
    return { action: "failover", error };
  }

  if (code === "AGY_HTTP") {
    if (error.status === 401 && !authRetried) return { action: "retry_auth", error };
    if (error.status === 401) return { action: "stop", error };
    if (Number(error.status) >= 500) return { action: "failover", error };
    return { action: "stop", error };
  }

  if (code === "AGY_EMPTY_OUTPUT") {
    if (slot === "stt" && hadSpeech) return { action: "failover", error };
    return { action: "stop", error };
  }

  if (isNetworkUnreachableError(error)) {
    if (remainingMs > SUBPROCESS_MIN_REMAINING_MS) return { action: "subprocess", error };
    return { action: "stop", error };
  }

  return { action: "stop", error };
}

function applyFailoverSideEffects(decision, modelId) {
  if (decision?.cooldownMs && modelId) {
    markModelCooldown(modelId, Date.now() + decision.cooldownMs);
  }
}

module.exports = {
  attemptStageMs,
  computeSttBudgetMs,
  isNetworkUnreachableError,
  decideAntigravityFailover,
  applyFailoverSideEffects,
  SUBPROCESS_MIN_REMAINING_MS,
};
