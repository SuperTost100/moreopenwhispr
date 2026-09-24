// Shared request-budget primitive for the Antigravity (agy) backend. One
// operation spans the whole request (auth -> project id -> gateway fetch ->
// body read); each stage gets its own bounded sub-signal via stageSignal() so
// a slow project-id lookup can't eat the budget a transcription fetch needs.
"use strict";

// Central typed-error constructor for all antigravity* helpers. Every code is
// a short AGY_* constant so callers can pattern-match without parsing message
// strings (never put secrets/tokens/transcript text in `message` or `extra`).
function createAntigravityError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) error[key] = value;
  }
  return error;
}

/**
 * classifyAbortError(err, callerSignal) -> "AGY_TIMEOUT" | "AGY_CANCELLED"
 *
 * `callerSignal` is the signal the *caller* originally handed to
 * createAntigravityOperation({ signal }) — the one only the caller controls.
 * If that specific signal fired, the caller deliberately cancelled the
 * operation. Any other abort (the operation's own budget timeout, or a
 * stageSignal's own AbortSignal.timeout) is a timeout, never a cancel — that
 * distinction is what AbortSignal.any() collapses away, so it has to be
 * recovered by checking the caller's signal directly rather than the error.
 */
function classifyAbortError(err, callerSignal) {
  if (callerSignal?.aborted) return "AGY_CANCELLED";
  // No caller signal in play (or it never fired): whatever aborted this was
  // budget/stage machinery, not a human/user cancel action.
  return "AGY_TIMEOUT";
}

function createAntigravityOperation({
  budgetMs,
  signal: callerSignal,
  label = "antigravity",
} = {}) {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new Error("createAntigravityOperation requires a positive budgetMs");
  }
  const deadline = Date.now() + budgetMs;
  const budgetSignal = AbortSignal.timeout(budgetMs);
  const signal = callerSignal ? AbortSignal.any([budgetSignal, callerSignal]) : budgetSignal;

  function remainingMs() {
    return Math.max(0, deadline - Date.now());
  }

  function throwIfDone() {
    if (signal.aborted) {
      const code = classifyAbortError(null, callerSignal);
      throw createAntigravityError(
        code,
        code === "AGY_CANCELLED" ? `${label} operation cancelled` : `${label} operation timed out`
      );
    }
    if (remainingMs() <= 0) {
      throw createAntigravityError("AGY_TIMEOUT", `${label} operation budget exhausted`);
    }
  }

  // Bounded per-stage signal: aborts when the whole operation aborts OR when
  // this stage's own (remaining-budget-capped) timer fires, whichever first.
  function stageSignal(maxMs) {
    const bound = Math.max(0, Math.min(maxMs, remainingMs()));
    return AbortSignal.any([signal, AbortSignal.timeout(bound)]);
  }

  return { signal, deadline, remainingMs, stageSignal, throwIfDone, callerSignal, label };
}

module.exports = {
  createAntigravityOperation,
  createAntigravityError,
  classifyAbortError,
};
