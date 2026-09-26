const test = require("node:test");
const assert = require("node:assert/strict");

let recordingErrors;

test.before(async () => {
  recordingErrors = await import("../../src/utils/recordingErrors.ts");
});

// A stand-in TFunction: returns the key itself (plus any interpolation
// options) so assertions can check which key was picked without pulling in
// i18next or the real translation files.
const t = (key, options) => (options ? `${key}:${JSON.stringify(options)}` : key);

// rework-audit/medium/01-missing-model-reported-as-rate-limit: a 404
// model-not-found response from the gateway must map to the
// antigravityModelUnavailable title/description, never to the rate-limit
// strings — even though getRecordingErrorDescription falls back to
// `error.messageKey` for codes it doesn't special-case, which is exactly how
// a rate-limit messageKey could otherwise leak through for an unrelated code.
test("AGY_MODEL_UNAVAILABLE (404, model not found) maps to the not-found strings, never the rate-limit ones", () => {
  const error = {
    code: "AGY_MODEL_UNAVAILABLE",
    status: 404,
    title: "fallback title",
    description: "models/gemini-3.7-flash-low is not found",
  };
  assert.equal(
    recordingErrors.getRecordingErrorTitle(error, t),
    "hooks.audioRecording.errorTitles.antigravityModelUnavailable"
  );
  assert.equal(
    recordingErrors.getRecordingErrorDescription(error, t),
    "hooks.audioRecording.errorDescriptions.antigravityModelUnavailable"
  );
});

test("AGY_MODEL_UNAVAILABLE still resolves to the not-found strings even if a stray rate-limit messageKey is attached", () => {
  // Guards the ordering inside getRecordingErrorDescription: the
  // AGY_MODEL_UNAVAILABLE branch must run before the generic
  // `if (error.messageKey) return t(error.messageKey)` fallback, or a
  // mistakenly-attached rate-limit messageKey would win.
  const error = {
    code: "AGY_MODEL_UNAVAILABLE",
    status: 404,
    title: "fallback title",
    messageKey: "hooks.audioRecording.errorDescriptions.providerRateLimited",
  };
  assert.equal(
    recordingErrors.getRecordingErrorDescription(error, t),
    "hooks.audioRecording.errorDescriptions.antigravityModelUnavailable"
  );
});

test("AGY_RATE_LIMITED still maps to the rate-limit strings (control case)", () => {
  const error = { code: "AGY_RATE_LIMITED", title: "fallback title" };
  assert.equal(
    recordingErrors.getRecordingErrorTitle(error, t),
    "hooks.audioRecording.errorTitles.antigravityQuotaExceeded"
  );
});
