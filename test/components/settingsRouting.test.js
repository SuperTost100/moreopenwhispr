const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/components/settings/settingsRouting.ts");

// Legacy identifier -> canonical section, per SECTION_ALIASES.
const SECTION_ALIAS_CASES = [
  ["aiModels", "llms"],
  ["agentConfig", "llms"],
  ["agentMode", "llms"],
  ["dictationAgent", "llms"],
  ["intelligence", "llms"],
  ["meetings", "llms"],
  ["prompts", "llms"],
  ["transcription", "speechToText"],
  ["uploadTranscription", "speechToText"],
  ["softwareUpdates", "system"],
  ["privacy", "privacyData"],
  ["permissions", "privacyData"],
  ["developer", "system"],
];

// Legacy identifier -> forced sub-tab, per LEGACY_SUB_TAB.
const LEGACY_SUB_TAB_CASES = [
  ["transcription", "dictation"],
  ["uploadTranscription", "upload"],
  ["dictationAgent", "dictationAgent"],
  ["meetings", "noteFormatting"],
  ["intelligence", "dictationCleanup"],
  ["agentMode", "chatIntelligence"],
  ["agentConfig", "chatIntelligence"],
  ["aiModels", "dictationCleanup"],
  ["prompts", "dictationCleanup"],
];

// Aliased identifiers that have no forced sub-tab.
const NO_SUB_TAB_CASES = ["developer", "permissions", "privacy", "softwareUpdates"];

// Canonical sections not clamped by the MOW account-section rule.
const NON_ACCOUNT_CANONICAL_SECTIONS = [
  "privacyData",
  "general",
  "hotkeys",
  "llms",
  "speechToText",
  "system",
];

// Canonical sections clamped to "general" on MOW builds.
const MOW_ACCOUNT_SECTIONS = ["account", "plansBilling", "workspace"];

test("SECTION_ALIASES maps every legacy identifier to its canonical section", async () => {
  const { SECTION_ALIASES } = await load();
  for (const [legacy, canonical] of SECTION_ALIAS_CASES) {
    assert.equal(SECTION_ALIASES[legacy], canonical, `alias mismatch for "${legacy}"`);
  }
  assert.equal(Object.keys(SECTION_ALIASES).length, SECTION_ALIAS_CASES.length);
});

test("LEGACY_SUB_TAB maps every legacy identifier to its forced sub-tab", async () => {
  const { LEGACY_SUB_TAB } = await load();
  for (const [legacy, subTab] of LEGACY_SUB_TAB_CASES) {
    assert.equal(LEGACY_SUB_TAB[legacy], subTab, `sub-tab mismatch for "${legacy}"`);
  }
  assert.equal(Object.keys(LEGACY_SUB_TAB).length, LEGACY_SUB_TAB_CASES.length);
});

test("resolveSettingsSection applies each legacy alias (MOW build: none of these are account sections)", async () => {
  const { resolveSettingsSection } = await load();
  for (const [legacy, canonical] of SECTION_ALIAS_CASES) {
    assert.equal(resolveSettingsSection(legacy), canonical, `resolve mismatch for "${legacy}"`);
  }
});

test("resolveLegacySubTab returns the forced sub-tab for every legacy identifier", async () => {
  const { resolveLegacySubTab } = await load();
  for (const [legacy, subTab] of LEGACY_SUB_TAB_CASES) {
    assert.equal(resolveLegacySubTab(legacy), subTab, `sub-tab mismatch for "${legacy}"`);
  }
});

test("resolveLegacySubTab returns undefined for aliased identifiers with no sub-tab entry", async () => {
  const { resolveLegacySubTab } = await load();
  for (const legacy of NO_SUB_TAB_CASES) {
    assert.equal(resolveLegacySubTab(legacy), undefined, `expected no sub-tab for "${legacy}"`);
  }
});

test("resolveLegacySubTab returns undefined when no section is given", async () => {
  const { resolveLegacySubTab } = await load();
  assert.equal(resolveLegacySubTab(undefined), undefined);
});

test("resolveSettingsSection passes through non-account canonical sections unchanged", async () => {
  const { resolveSettingsSection } = await load();
  for (const canonical of NON_ACCOUNT_CANONICAL_SECTIONS) {
    assert.equal(resolveSettingsSection(canonical), canonical);
  }
});

// This repo's mowProfile.ts hardcodes `MOW_PROFILE.enabled = true` (`as const`),
// so isMowBuild() always returns true and cannot be toggled from a test without
// mutating the module. The MOW clamp below is therefore ALWAYS the live path in
// this build; the non-clamped (non-MOW) branch of resolveSettingsSection --
// where "account"/"plansBilling"/"workspace" would pass through unchanged, and
// where an undefined section resolves to "account" instead of "general" -- is
// untested here because this codebase has no way to produce a non-MOW build.
test("resolveSettingsSection clamps account-only sections to \"general\" (MOW build is always active here)", async () => {
  const { resolveSettingsSection } = await load();
  for (const section of MOW_ACCOUNT_SECTIONS) {
    assert.equal(resolveSettingsSection(section), "general", `expected clamp for "${section}"`);
  }
});

test("resolveSettingsSection defaults an undefined section to \"general\" (MOW build is always active here)", async () => {
  const { resolveSettingsSection } = await load();
  assert.equal(resolveSettingsSection(undefined), "general");
});

test("resolveSettingsSection passes an unknown identifier through unchanged (no alias, not an account section)", async () => {
  const { resolveSettingsSection } = await load();
  assert.equal(resolveSettingsSection("totally-unknown-section"), "totally-unknown-section");
});
