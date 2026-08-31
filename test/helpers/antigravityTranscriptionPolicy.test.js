const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAntigravityTranscribeModel,
  isAntigravityLiveModel,
  shouldSkipAntigravityDictationCleanup,
  resolveAntigravityTranscriptionMode,
} = require("../../src/helpers/antigravityTranscriptionPolicy");

test("isAntigravityTranscribeModel recognizes transcribe ids", () => {
  assert.equal(isAntigravityTranscribeModel("gemini-3.5-transcribe"), true);
  assert.equal(isAntigravityTranscribeModel("gemini-3.5-transcribe-live"), true);
  assert.equal(isAntigravityTranscribeModel("gemini-3.5-flash-low"), false);
});

test("isAntigravityLiveModel recognizes live id only", () => {
  assert.equal(isAntigravityLiveModel("gemini-3.5-transcribe-live"), true);
  assert.equal(isAntigravityLiveModel("gemini-3.5-transcribe"), false);
});

test("shouldSkipAntigravityDictationCleanup in fast smart mode", () => {
  assert.equal(
    shouldSkipAntigravityDictationCleanup({
      cloudTranscriptionProvider: "antigravity",
      cloudTranscriptionModel: "gemini-3.5-transcribe",
      antigravityDictationMode: "fast",
      antigravityTranscriptionMode: "smart",
    }),
    true
  );
});

test("shouldSkipAntigravityDictationCleanup when polished or verbatim", () => {
  assert.equal(
    shouldSkipAntigravityDictationCleanup({
      cloudTranscriptionProvider: "antigravity",
      cloudTranscriptionModel: "gemini-3.5-transcribe",
      antigravityDictationMode: "polished",
      antigravityTranscriptionMode: "smart",
    }),
    false
  );
  assert.equal(
    shouldSkipAntigravityDictationCleanup({
      cloudTranscriptionProvider: "antigravity",
      cloudTranscriptionModel: "gemini-3.5-transcribe",
      antigravityDictationMode: "fast",
      antigravityTranscriptionMode: "verbatim",
    }),
    false
  );
});

test("resolveAntigravityTranscriptionMode normalizes values", () => {
  assert.equal(resolveAntigravityTranscriptionMode({ antigravityTranscriptionMode: "verbatim" }), "VERBATIM");
  assert.equal(resolveAntigravityTranscriptionMode({}), "SMART");
});
