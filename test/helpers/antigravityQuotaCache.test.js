const test = require("node:test");
const assert = require("node:assert/strict");

test("gateway quota cache marks hot then clears", async () => {
  const {
    isGatewayQuotaHot,
    markGatewayQuotaExhausted,
    clearGatewayQuotaCache,
    GATEWAY_QUOTA_COOLDOWN_MS,
  } = await import("../../src/helpers/antigravityQuotaCache.js");

  clearGatewayQuotaCache();
  assert.equal(isGatewayQuotaHot(), false);

  const now = 1_000_000;
  markGatewayQuotaExhausted(now);
  assert.equal(isGatewayQuotaHot(now + 1), true);
  assert.equal(isGatewayQuotaHot(now + GATEWAY_QUOTA_COOLDOWN_MS - 1), true);
  assert.equal(isGatewayQuotaHot(now + GATEWAY_QUOTA_COOLDOWN_MS), false);

  clearGatewayQuotaCache();
  assert.equal(isGatewayQuotaHot(now + 1), false);
});
