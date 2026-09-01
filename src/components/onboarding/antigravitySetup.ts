import type { CleanupSettings, TranscriptionSettings } from "../../hooks/useSettings";

export const ANTIGRAVITY_ONBOARDING = {
  provider: "antigravity",
  transcriptionModel: "gemini-3.5-transcribe",
  cleanupModel: "gemini-3.7-flash-low",
  chatModel: "gemini-3.7-flash-medium",
} as const;

type AntigravitySetupStore = {
  setCloudTranscriptionForAllScopes: (settings: Partial<TranscriptionSettings>) => void;
  setCloudReasoningForAllScopes: (settings: Partial<CleanupSettings>) => void;
  updateCleanupSettings: (settings: Partial<CleanupSettings>) => void;
  setChatAgentModel: (model: string) => void;
};

/** Route every transcription + LLM scope through local `agy`. No API keys. */
export function applyAntigravityOnboarding(
  store: AntigravitySetupStore,
  agentAllowed: boolean
): void {
  store.setCloudTranscriptionForAllScopes({
    useLocalWhisper: false,
    cloudTranscriptionMode: "byok",
    cloudTranscriptionProvider: ANTIGRAVITY_ONBOARDING.provider,
    cloudTranscriptionModel: ANTIGRAVITY_ONBOARDING.transcriptionModel,
  });
  if (!agentAllowed) {
    store.updateCleanupSettings({ useCleanupModel: false });
    return;
  }
  store.setCloudReasoningForAllScopes({
    cleanupCloudMode: "byok",
    cleanupProvider: ANTIGRAVITY_ONBOARDING.provider,
    cleanupModel: ANTIGRAVITY_ONBOARDING.cleanupModel,
    useCleanupModel: true,
    useDictationAgent: true,
  });
  store.setChatAgentModel(ANTIGRAVITY_ONBOARDING.chatModel);
}
