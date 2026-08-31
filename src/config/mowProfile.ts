import type { InferenceMode } from "../types/electron";

/** MoreOpenWhispr (MOW): no OpenWhispr Cloud accounts, billing, sync, or telemetry. */
export const MOW_PROFILE = {
  enabled: true,
  productName: "MoreOpenWhispr",
  shortName: "MOW",
  upstreamName: "OpenWhispr",
  upstreamUrl: "https://github.com/OpenWhispr/openwhispr",
  repoUrl: "https://github.com/SuperTost100/openwhispr",
  docsUrl: "https://github.com/SuperTost100/openwhispr#readme",
  issuesUrl: "https://github.com/SuperTost100/openwhispr/issues",
} as const;

export const MOW_ACCOUNT_MODES = new Set(["openwhispr"]);
export const MOW_ACCOUNT_SETTINGS_SECTIONS = new Set(["account", "plansBilling", "workspace"]);

export function isMowBuild(): boolean {
  return MOW_PROFILE.enabled;
}

export function withoutAccountModes<T extends { id: string }>(modes: readonly T[]): T[] {
  if (!isMowBuild()) return [...modes];
  return modes.filter((mode) => !MOW_ACCOUNT_MODES.has(mode.id));
}

export function coerceInferenceMode(mode: string): InferenceMode {
  if (isMowBuild() && mode === "openwhispr") return "providers";
  return mode as InferenceMode;
}

export function coerceCloudMode(mode: string): string {
  if (isMowBuild() && mode === "openwhispr") return "byok";
  return mode;
}

export function mowRepoUrl(path = ""): string {
  const base = MOW_PROFILE.repoUrl.replace(/\/$/, "");
  return path ? `${base}/${path.replace(/^\//, "")}` : base;
}
