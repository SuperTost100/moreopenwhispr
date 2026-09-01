"use strict";

// ponytail: CJS mirror of mowProfile.ts for Electron main / node --test require().
// Named .cjs so Vite SSR prefers mowProfile.ts (its resolve order ranks .js before .ts).
const MOW_PROFILE = {
  enabled: true,
  productName: "MoreOpenWhispr",
  shortName: "MOW",
  upstreamName: "OpenWhispr",
  upstreamUrl: "https://github.com/OpenWhispr/openwhispr",
  githubOwner: "SuperTost100",
  githubRepo: "moreopenwhispr",
  repoUrl: "https://github.com/SuperTost100/moreopenwhispr",
  docsUrl: "https://github.com/SuperTost100/moreopenwhispr#readme",
  issuesUrl: "https://github.com/SuperTost100/moreopenwhispr/issues",
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

module.exports = {
  MOW_PROFILE,
  MOW_ACCOUNT_MODES,
  MOW_ACCOUNT_SETTINGS_SECTIONS,
  isMowBuild,
  withoutAccountModes,
  coerceInferenceMode,
  coerceCloudMode,
  mowRepoUrl,
};
