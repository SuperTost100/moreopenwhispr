const test = require("node:test");
const assert = require("node:assert/strict");
const AgentStreamRequestRegistry = require("../../src/helpers/agentStreamRequestRegistry");
const { sttBudgetFromPayload, chatPrefsFromPayload } = require("../../src/helpers/antigravityIpc");
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

test("chatPrefsFromPayload prefers an explicit per-turn model pick over the settings default", () => {
  // Regression: process-antigravity-chat-turn used to ignore payload.model
  // (the renderer's already-resolved chat model) entirely, so every
  // tool-enabled chat turn resolved as "auto" no matter what the user
  // picked.
  assert.equal(
    chatPrefsFromPayload({ model: "gemini-3.5-flash", antigravityChatModel: "gemini-2.5-pro" })
      .chat,
    "gemini-3.5-flash"
  );
});

test("chatPrefsFromPayload falls back to the settings antigravityChatModel when no explicit pick is sent", () => {
  assert.equal(
    chatPrefsFromPayload({ antigravityChatModel: "gemini-2.5-pro" }).chat,
    "gemini-2.5-pro"
  );
});

test("chatPrefsFromPayload falls back to auto when neither an explicit pick nor a setting is present", () => {
  assert.equal(chatPrefsFromPayload({}).chat, "auto");
});

test("chatPrefsFromPayload ignores a blank/whitespace-only explicit model", () => {
  assert.equal(
    chatPrefsFromPayload({ model: "   ", antigravityChatModel: "gemini-2.5-pro" }).chat,
    "gemini-2.5-pro"
  );
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

test("getAntigravityStatus tells a missing CLI, a dead sign-in, a working one and an unknown apart", async () => {
  const { getAntigravityStatus } = require("../../src/helpers/antigravityIpc");
  const err = (code) => Object.assign(new Error(code), { code });
  const found = () => {};

  assert.deepEqual(
    await getAntigravityStatus({
      resolveBinary: () => {
        throw new Error("agy not found");
      },
      getAccessToken: async () => assert.fail("no token read without the CLI"),
    }),
    { state: "missing" }
  );
  assert.deepEqual(
    await getAntigravityStatus({
      resolveBinary: found,
      getAccessToken: async () => {
        throw err("AGY_AUTH_REQUIRED");
      },
    }),
    { state: "signedOut" }
  );
  assert.deepEqual(
    await getAntigravityStatus({ resolveBinary: found, getAccessToken: async () => ({}) }),
    { state: "signedIn" }
  );
  // Offline or slow is not "signed out".
  assert.deepEqual(
    await getAntigravityStatus({
      resolveBinary: found,
      getAccessToken: async () => {
        throw err("AGY_TIMEOUT");
      },
    }),
    { state: "unknown", code: "AGY_TIMEOUT" }
  );
});

test("getAntigravityStatus bounds the token check with its own operation", async () => {
  const { getAntigravityStatus } = require("../../src/helpers/antigravityIpc");
  let receivedOp;
  await getAntigravityStatus({
    resolveBinary: () => {},
    getAccessToken: async ({ op }) => {
      receivedOp = op;
    },
    budgetMs: 1234,
  });
  assert.ok(receivedOp?.signal, "the token read gets an abortable operation");
  assert.ok(receivedOp.remainingMs() <= 1234);
});
