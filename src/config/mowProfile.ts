import type { InferenceMode } from "../types/electron";

const githubOwner = "SuperTost100";
const githubRepo = "moreopenwhisperer";
const repoUrl = `https://github.com/${githubOwner}/${githubRepo}` as const;

/** MoreOpenWhisperer (MOW): no OpenWhispr Cloud accounts, billing, sync, or telemetry. */
export const MOW_PROFILE = {
  enabled: true,
  productName: "MoreOpenWhisperer",
  shortName: "MOW",
  upstreamName: "OpenWhispr",
  upstreamUrl: "https://github.com/OpenWhispr/openwhispr",
  githubOwner,
  githubRepo,
  repoUrl,
  docsUrl: `${repoUrl}#readme`,
  issuesUrl: `${repoUrl}/issues`,
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

export function rewriteUpstreamBrand<T>(value: T): T {
  if (typeof value !== "string") return value;
  return value.replaceAll(MOW_PROFILE.upstreamName, MOW_PROFILE.productName) as T;
}
