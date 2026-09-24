const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAntigravityOperation,
  createAntigravityError,
  classifyAbortError,
} = require("../../src/helpers/antigravityOperation");

test("createAntigravityError sets code and extra fields", () => {
  const error = createAntigravityError("AGY_HTTP", "boom", { status: 503, scope: "model" });
  assert.equal(error.code, "AGY_HTTP");
  assert.equal(error.message, "boom");
  assert.equal(error.status, 503);
  assert.equal(error.scope, "model");
});

test("createAntigravityOperation exposes a positive remainingMs that counts down", () => {
  const op = createAntigravityOperation({ budgetMs: 5000 });
  assert.ok(op.remainingMs() > 0);
  assert.ok(op.remainingMs() <= 5000);
  assert.ok(op.deadline > Date.now());
});

test("throwIfDone does not throw while budget remains", () => {
  const op = createAntigravityOperation({ budgetMs: 5000 });
  assert.doesNotThrow(() => op.throwIfDone());
});

test("throwIfDone throws AGY_TIMEOUT once the budget is exhausted", async () => {
  const op = createAntigravityOperation({ budgetMs: 10 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.throws(
    () => op.throwIfDone(),
    (err) => err.code === "AGY_TIMEOUT"
  );
});

test("throwIfDone throws AGY_CANCELLED when the caller's own signal aborted it", () => {
  const controller = new AbortController();
  const op = createAntigravityOperation({ budgetMs: 5000, signal: controller.signal });
  controller.abort();
  assert.throws(
    () => op.throwIfDone(),
    (err) => err.code === "AGY_CANCELLED"
  );
});

test("classifyAbortError distinguishes a caller cancel from a budget/stage timeout", () => {
  const controller = new AbortController();
  // Caller's own signal fired -> cancelled, regardless of the error passed in.
  controller.abort();
  assert.equal(classifyAbortError(new Error("aborted"), controller.signal), "AGY_CANCELLED");

  // Caller's own signal never fired -> whatever aborted this was budget/stage
  // machinery, so it's a timeout even though the underlying AbortError looks
  // identical to a cancel.
  const neverAborted = new AbortController().signal;
  assert.equal(classifyAbortError(new Error("aborted"), neverAborted), "AGY_TIMEOUT");

  // No caller signal in play at all.
  assert.equal(classifyAbortError(new Error("aborted"), undefined), "AGY_TIMEOUT");
});

test("stageSignal aborts on its own timeout without the caller cancelling", async () => {
  const op = createAntigravityOperation({ budgetMs: 5000 });
  const stage = op.stageSignal(10);
  assert.equal(stage.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stage.aborted, true);
  assert.equal(op.signal.aborted, false, "a stage timeout must not abort the whole operation");
  assert.equal(
    classifyAbortError(new Error("aborted"), op.callerSignal),
    "AGY_TIMEOUT",
    "a stage-local timeout must classify as AGY_TIMEOUT, never AGY_CANCELLED"
  );
});

test("stageSignal aborts when the caller cancels the whole operation", () => {
  const controller = new AbortController();
  const op = createAntigravityOperation({ budgetMs: 5000, signal: controller.signal });
  const stage = op.stageSignal(4000);
  assert.equal(stage.aborted, false);
  controller.abort();
  assert.equal(stage.aborted, true);
  assert.equal(
    classifyAbortError(new Error("aborted"), op.callerSignal),
    "AGY_CANCELLED",
    "a caller cancel propagated through a stage signal must still classify as AGY_CANCELLED"
  );
});

test("stageSignal never exceeds the operation's remaining budget", async () => {
  const op = createAntigravityOperation({ budgetMs: 20 });
  await new Promise((resolve) => setTimeout(resolve, 25));
  // Budget is already exhausted; a stage asking for 10s should still abort
  // almost immediately because it's bounded by remainingMs(), which is 0.
  const stage = op.stageSignal(10_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(stage.aborted, true);
});
