"use strict";

// ponytail: CJS mirror of mowProfile.ts for Electron main / node --test require().
// Named .cjs so Vite SSR prefers mowProfile.ts (its resolve order ranks .js before .ts).
const githubOwner = "SuperTost100";
const githubRepo = "moreopenwhispr";
const repoUrl = `https://github.com/${githubOwner}/${githubRepo}`;

const MOW_PROFILE = {
  enabled: true,
  productName: "MoreOpenWhispr",
  shortName: "MOW",
  upstreamName: "OpenWhispr",
  upstreamUrl: "https://github.com/OpenWhispr/openwhispr",
  githubOwner,
  githubRepo,
  repoUrl,
  docsUrl: `${repoUrl}#readme`,
  issuesUrl: `${repoUrl}/issues`,
};

const MOW_ACCOUNT_MODES = new Set(["openwhispr"]);
const MOW_ACCOUNT_SETTINGS_SECTIONS = new Set(["account", "plansBilling", "workspace"]);

function isMowBuild() {
  return MOW_PROFILE.enabled;
}

function withoutAccountModes(modes) {
  if (!isMowBuild()) return [...modes];
  return modes.filter((mode) => !MOW_ACCOUNT_MODES.has(mode.id));
}

function coerceInferenceMode(mode) {
  if (isMowBuild() && mode === "openwhispr") return "providers";
  return mode;
}

function coerceCloudMode(mode) {
  if (isMowBuild() && mode === "openwhispr") return "byok";
  return mode;
}

function mowRepoUrl(path = "") {
  const base = MOW_PROFILE.repoUrl.replace(/\/$/, "");
  return path ? `${base}/${path.replace(/^\//, "")}` : base;
}

function rewriteUpstreamBrand(value) {
  if (typeof value !== "string") return value;
  return value.replaceAll(MOW_PROFILE.upstreamName, MOW_PROFILE.productName);
}

module.exports = {
  MOW_PROFILE,
  MOW_ACCOUNT_MODES,
  MOW_ACCOUNT_SETTINGS_SECTIONS,
  isMowBuild,
  withoutAccountModes,
  coerceInferenceMode,
  coerceCloudMode,
  mowRepoUrl,
  rewriteUpstreamBrand,
};
