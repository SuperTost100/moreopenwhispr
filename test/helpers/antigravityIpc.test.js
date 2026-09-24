const test = require("node:test");
const assert = require("node:assert/strict");
const AgentStreamRequestRegistry = require("../../src/helpers/agentStreamRequestRegistry");
const { sttBudgetFromPayload } = require("../../src/helpers/antigravityIpc");
const {
  resolveAntigravityModels,
  STATIC_FALLBACK_CATALOG,
} = require("../../src/helpers/antigravityModelCatalog");

test("sttBudgetFromPayload uses audio duration with 90s cap", () => {
  assert.equal(sttBudgetFromPayload({ audioDurationSec: 10 }), 17_000);
  assert.equal(sttBudgetFromPayload({}), 27_000);
});

test("AgentStreamRequestRegistry cancel aborts matching requestId only", () => {
  const registry = new AgentStreamRequestRegistry();
  const a = registry.begin(1, "a");
  const b = registry.begin(1, "b");
  assert.equal(registry.cancel(1, "a"), true);
  assert.equal(a.signal.aborted, true);
  assert.equal(b.signal.aborted, false);
  registry.cancelSender(1);
  assert.equal(b.signal.aborted, true);
});

test("resolveAntigravityModels honors explicit stt pref from settings", () => {
  const catalog = {
    ...STATIC_FALLBACK_CATALOG,
    models: {
      ...STATIC_FALLBACK_CATALOG.models,
      "gemini-custom-stt": {
        displayName: "Custom",
        supportsImages: false,
        supportsThinking: false,
        supportedMimeTypes: { "audio/wav": true },
        quotaInfo: {},
        recommended: false,
        tagTitle: null,
      },
    },
  };
  const resolved = resolveAntigravityModels(catalog, { stt: "gemini-custom-stt" });
  assert.equal(resolved.stt, "gemini-custom-stt");
  assert.equal(resolved.candidates.stt[0], "gemini-custom-stt");
});
