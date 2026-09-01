// ESM mirror of antigravityModels.cjs for the renderer. The implementation has
// to exist as CJS (Electron main requires it) and Vite's SSR runner evaluates
// even a .cjs source file as ESM, so the two copies are kept in sync by
// test/helpers/antigravityModels.test.js rather than by a re-export.

// agy catalogs effort as part of the model id (gemini-3.7-flash-low). Current
// agy no longer lists gemini-3.5-flash-*; --effort on a *-low id is redundant
// and older CLI builds reject it.
export const DEFAULT_ANTIGRAVITY_MODEL = "gemini-3.7-flash-low";

export const RETIRED_AGY_CLI_MODELS: Record<string, string> = {
  "gemini-3.5-flash-low": "gemini-3.7-flash-low",
  "gemini-3.5-flash-medium": "gemini-3.7-flash-medium",
  "gemini-3.5-flash-high": "gemini-3.7-flash-high",
};

export function resolveAgyCliModel(model: string): string {
  const trimmed = String(model || "").trim();
  if (!trimmed) return DEFAULT_ANTIGRAVITY_MODEL;
  return RETIRED_AGY_CLI_MODELS[trimmed] || trimmed;
}

export function withoutEffortArgs(extraArgs: string[] = []): string[] {
  const out: string[] = [];
  for (let i = 0; i < extraArgs.length; i += 1) {
    if (extraArgs[i] === "--effort") {
      i += 1;
      continue;
    }
    out.push(extraArgs[i]);
  }
  return out;
}
