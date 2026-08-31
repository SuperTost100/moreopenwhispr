const DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL = "gemini-3.5-transcribe";

const TRANSCRIBE_MODEL_IDS = new Set([
  "gemini-3.5-transcribe",
  "gemini-3.5-transcribe-preview",
  "gemini-3.5-transcribe-live",
]);

function isAntigravityTranscribeModel(model) {
  const id = String(model || "").trim();
  return TRANSCRIBE_MODEL_IDS.has(id) || id.startsWith("gemini-3.5-transcribe");
}

function resolveAntigravityTranscriptionMode(settings) {
  const mode = settings?.antigravityTranscriptionMode;
  if (mode === "verbatim" || mode === "VERBATIM") return "VERBATIM";
  return "SMART";
}

function resolveAntigravityDictationMode(settings) {
  return settings?.antigravityDictationMode === "polished" ? "polished" : "fast";
}

function shouldSkipAntigravityDictationCleanup(settings) {
  if (resolveAntigravityDictationMode(settings) === "polished") {
    return false;
  }
  const provider = settings?.cloudTranscriptionProvider;
  if (provider !== "antigravity") {
    return false;
  }
  const model = settings?.cloudTranscriptionModel || DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL;
  if (!isAntigravityTranscribeModel(model)) {
    return false;
  }
  return resolveAntigravityTranscriptionMode(settings) === "SMART";
}

module.exports = {
  DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL,
  TRANSCRIBE_MODEL_IDS,
  isAntigravityTranscribeModel,
  resolveAntigravityTranscriptionMode,
  resolveAntigravityDictationMode,
  shouldSkipAntigravityDictationCleanup,
};
