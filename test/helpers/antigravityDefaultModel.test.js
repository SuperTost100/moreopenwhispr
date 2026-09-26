const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// M09: the live Antigravity catalog rotates to a newer model generation
// (gemini-3.8-flash-*) faster than this app ships. A fresh install (no saved
// settings) used to hard-code gemini-3.7-flash-* as the chat/dictation-agent
// and dictation-cleanup model, which pins an explicit pick in
// resolveAntigravityModels and bypasses the "pick the newest tier" auto
// policy. Defaults must resolve to "auto" instead so a catalog rotation
// never needs an app release.
test("fresh antigravity settings default to auto, not a pinned model generation", async (t) => {
  const { storage } = installBrowserGlobals(t);
  storage.clear();

  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-antigravity-default-model-test-",
  });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const state = useSettingsStore.getState();

  assert.equal(state.chatAgentProvider, "antigravity");
  assert.equal(state.chatAgentModel, "auto");
  assert.equal(state.dictationAgentProvider, "antigravity");
  assert.equal(state.dictationAgentModel, "auto");
  assert.equal(state.cleanupProvider, "antigravity");
  assert.equal(state.cleanupModel, "auto");
});
