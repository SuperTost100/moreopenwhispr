const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attemptStageMs,
  computeSttBudgetMs,
  decideAntigravityFailover,
} = require("../../src/helpers/antigravityFailover");

const err = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra });

test("computeSttBudgetMs caps at 90s and defaults unknown duration to 30s", () => {
  assert.equal(computeSttBudgetMs({ audioDurationSec: 10 }), 12_000 + 5_000);
  assert.equal(computeSttBudgetMs({ audioDurationSec: 200 }), 90_000);
  assert.equal(computeSttBudgetMs({}), 12_000 + 15_000);
});

test("decideAntigravityFailover decision table", () => {
  const stop = (e, ctx = {}) => assert.equal(decideAntigravityFailover(e, ctx).action, "stop");
  const failover = (e, ctx = {}) =>
    assert.equal(decideAntigravityFailover(e, ctx).action, "failover");

  stop(err("AGY_CANCELLED"));
  stop(err("AGY_AUTH_REQUIRED"));
  stop(err("AGY_BLOCKED"));
  stop(err("AGY_RATE_LIMITED", { scope: "account" }));

  failover(err("AGY_RATE_LIMITED", { scope: "model", retryAfterMs: 5000 }));
  failover(err("AGY_MODEL_UNAVAILABLE"));
  failover(err("AGY_HTTP", { status: 503 }));
  failover(err("AGY_TIMEOUT"), { budgetExhausted: false });
  stop(err("AGY_TIMEOUT"), { budgetExhausted: true });

  assert.equal(
    decideAntigravityFailover(err("AGY_HTTP", { status: 401 }), { authRetried: false }).action,
    "retry_auth"
  );
  stop(err("AGY_HTTP", { status: 401 }), { authRetried: true });

  failover(err("AGY_EMPTY_OUTPUT"), { slot: "stt", hadSpeech: true });
  stop(err("AGY_EMPTY_OUTPUT"), { slot: "stt", hadSpeech: false });

  // A stream that ends without a terminal finishReason is a stage failure,
  // not a dead end — the next candidate model should get a shot.
  failover(err("AGY_TRUNCATED"));

  assert.equal(
    decideAntigravityFailover(Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }), {
      remainingMs: 9000,
    }).action,
    "subprocess"
  );
  stop(Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" }), { remainingMs: 1000 });
});

test("attemptStageMs keeps budget back for the candidates still queued", () => {
  assert.equal(attemptStageMs(20_000, 1), 20_000, "the last candidate gets everything left");
  assert.equal(attemptStageMs(20_000, 3), 12_000);
  assert.equal(attemptStageMs(5_000, 2), 4_000, "never below the floor");
  assert.equal(attemptStageMs(3_000, 2), 3_000, "never above what is left");
  assert.equal(attemptStageMs(undefined, 2), 0);
});
