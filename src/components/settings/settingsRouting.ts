import type { SettingsSectionType } from "../SettingsPage";
import { MOW_ACCOUNT_SETTINGS_SECTIONS, isMowBuild } from "../../config/mowProfile";

// The old AI Models sidebar had four items (transcription, meetings,
// intelligence, agentMode) — they now collapse into two: speechToText + llms.
// Legacy deep-links land on the matching sub-tab via LEGACY_SUB_TAB.
// "dictationAgent" is a live deep-link (the Home GPU banner), not a legacy alias.
export const SECTION_ALIASES: Record<string, SettingsSectionType> = {
  aiModels: "llms",
  agentConfig: "llms",
  agentMode: "llms",
  dictationAgent: "llms",
  intelligence: "llms",
  meetings: "llms",
  prompts: "llms",
  transcription: "speechToText",
  uploadTranscription: "speechToText",
  softwareUpdates: "system",
  privacy: "privacyData",
  permissions: "privacyData",
  developer: "system",
};

export const LEGACY_SUB_TAB: Record<string, string> = {
  transcription: "dictation",
  uploadTranscription: "upload",
  dictationAgent: "dictationAgent",
  meetings: "noteFormatting",
  intelligence: "dictationCleanup",
  agentMode: "chatIntelligence",
  agentConfig: "chatIntelligence",
  aiModels: "dictationCleanup",
  prompts: "dictationCleanup",
};

/**
 * Resolves a (possibly legacy) section identifier to a canonical
 * SettingsSectionType, applying legacy aliases first and then clamping
 * account-only sections to "general" on MOW builds.
 */
export function resolveSettingsSection(section: string | undefined): SettingsSectionType {
  if (!section) return isMowBuild() ? "general" : "account";
  const resolved = (SECTION_ALIASES[section] ?? section) as SettingsSectionType;
  if (isMowBuild() && MOW_ACCOUNT_SETTINGS_SECTIONS.has(resolved)) return "general";
  return resolved;
}

/** Returns the legacy sub-tab a legacy section identifier should land on, if any. */
export function resolveLegacySubTab(section: string | undefined): string | undefined {
  if (!section) return undefined;
  return LEGACY_SUB_TAB[section];
}
