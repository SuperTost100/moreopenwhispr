"use strict";

// agy catalogs effort as part of the model id (gemini-3.7-flash-low). Current
// agy no longer lists gemini-3.5-flash-*; --effort on a *-low id is redundant
// and older CLI builds reject it.
const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.7-flash-low";

const RETIRED_AGY_CLI_MODELS = {
  "gemini-3.5-flash-low": "gemini-3.7-flash-low",
  "gemini-3.5-flash-medium": "gemini-3.7-flash-medium",
  "gemini-3.5-flash-high": "gemini-3.7-flash-high",
};

function resolveAgyCliModel(model) {
  const trimmed = String(model || "").trim();
  if (!trimmed) return DEFAULT_ANTIGRAVITY_MODEL;
  return RETIRED_AGY_CLI_MODELS[trimmed] || trimmed;
}

function withoutEffortArgs(extraArgs = []) {
  const out = [];
  for (let i = 0; i < extraArgs.length; i += 1) {
    if (extraArgs[i] === "--effort") {
      i += 1;
      continue;
    }
    out.push(extraArgs[i]);
  }
  return out;
}

module.exports = {
  DEFAULT_ANTIGRAVITY_MODEL,
  RETIRED_AGY_CLI_MODELS,
  resolveAgyCliModel,
  withoutEffortArgs,
};
