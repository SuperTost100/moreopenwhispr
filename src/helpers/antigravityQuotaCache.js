// ponytail: in-process only; resets on app restart. Upgrade: persist + backoff from Retry-After.
const GATEWAY_QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
let gatewayQuotaHotUntil = 0;

function isGatewayQuotaHot(now = Date.now()) {
  return now < gatewayQuotaHotUntil;
}

function markGatewayQuotaExhausted(now = Date.now()) {
  gatewayQuotaHotUntil = now + GATEWAY_QUOTA_COOLDOWN_MS;
}

function clearGatewayQuotaCache() {
  gatewayQuotaHotUntil = 0;
}

module.exports = {
  GATEWAY_QUOTA_COOLDOWN_MS,
  isGatewayQuotaHot,
  markGatewayQuotaExhausted,
  clearGatewayQuotaCache,
};
