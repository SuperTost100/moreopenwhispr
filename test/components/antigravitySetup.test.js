const assert = require("node:assert/strict");
const test = require("node:test");

test("applyAntigravityOnboarding routes every scope through agy", async () => {
  const { applyAntigravityOnboarding, ANTIGRAVITY_ONBOARDING } = await import(
    "../../src/components/onboarding/antigravitySetup.ts"
  );
  const calls = [];
  const store = {
    setCloudTranscriptionForAllScopes: (s) => calls.push(["transcription", s]),
    setCloudReasoningForAllScopes: (s) => calls.push(["reasoning", s]),
    updateCleanupSettings: (s) => calls.push(["cleanup", s]),
    setChatAgentModel: (m) => calls.push(["chatModel", m]),
  };
  applyAntigravityOnboarding(store, true);
  assert.equal(calls[0][0], "transcription");
  assert.equal(calls[0][1].cloudTranscriptionModel, ANTIGRAVITY_ONBOARDING.transcriptionModel);
  assert.equal(calls[0][1].cloudTranscriptionProvider, ANTIGRAVITY_ONBOARDING.provider);
  assert.equal(calls[1][0], "reasoning");
  assert.equal(calls[1][1].cleanupProvider, ANTIGRAVITY_ONBOARDING.provider);
  assert.equal(calls[2][1], ANTIGRAVITY_ONBOARDING.chatModel);
});

test("applyAntigravityOnboarding disables cleanup when the agent is disallowed", async () => {
  const { applyAntigravityOnboarding } = await import(
    "../../src/components/onboarding/antigravitySetup.ts"
  );
  const calls = [];
  applyAntigravityOnboarding(
    {
      setCloudTranscriptionForAllScopes: (s) => calls.push(["transcription", s]),
      setCloudReasoningForAllScopes: (s) => calls.push(["reasoning", s]),
      updateCleanupSettings: (s) => calls.push(["cleanup", s]),
      setChatAgentModel: (m) => calls.push(["chatModel", m]),
    },
    false
  );
  assert.deepEqual(
    calls.map((c) => c[0]),
    ["transcription", "cleanup"]
  );
  assert.equal(calls[1][1].useCleanupModel, false);
});
