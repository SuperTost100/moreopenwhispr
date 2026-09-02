// Pure view model for the configured dictation processing route. Describes what
// settings say should happen — not auth health, quota, readiness, fallback, or
// historical provider use. Loaded by node tests and the renderer alike:
// erasable TypeScript only, explicit import extensions, no store mutation.
import modelRegistryData from "../../models/modelRegistryData.json" with { type: "json" };
import {
  resolveTranscriptionRoute,
  type TranscriptionRoute,
} from "../../helpers/transcriptionRoute.ts";
import { shouldSkipAntigravityDictationCleanup } from "../../helpers/dictationRouting.js";
import { getMicrophoneSelectionMode } from "../../helpers/microphoneSelection.js";
import {
  selectIsCloudCleanupMode,
  selectResolvedLLMConfig,
  type SettingsState,
} from "../../stores/settingsStore";
import type { PolicyDecisionSnapshot } from "../../stores/policyRules.ts";
import type { InferenceMode } from "../../types/electron";

export type ProcessingRouteBoundary =
  "onDevice" | "audioLeavesDevice" | "apiKey" | "customRoute" | "providerRequest";

export type ProcessingRouteStageId = "capture" | "transcribe" | "cleanup" | "delivery";

export interface ProcessingRouteStageViewModel {
  id: ProcessingRouteStageId;
  boundary: ProcessingRouteBoundary;
  detailKey: string;
  detailParams?: Record<string, string>;
  skipped?: boolean;
}

export interface ConfiguredProcessingRouteViewModel {
  stages: ProcessingRouteStageViewModel[];
  policyManaged: boolean;
}

export interface ConfiguredProcessingRouteInput {
  /** Policy-effective settings snapshot — callers overlay policy before invoking. */
  settings: SettingsState;
  policy?: PolicyDecisionSnapshot | null;
}

const DETAIL_PREFIX = "controlPanel.processingRoute.details";

function endpointHost(rawUrl: string | undefined): string | null {
  const trimmed = (rawUrl || "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}

function transcriptionProviderName(providerId: string): string {
  return (
    modelRegistryData.transcriptionProviders.find((provider) => provider.id === providerId)?.name ||
    providerId
  );
}

function cloudProviderName(providerId: string): string {
  return (
    modelRegistryData.cloudProviders.find((provider) => provider.id === providerId)?.name ||
    modelRegistryData.enterpriseProviders.find((provider) => provider.id === providerId)?.name ||
    providerId
  );
}

function whisperModelLabel(modelId: string): string {
  const entry =
    modelRegistryData.whisperModels[modelId as keyof typeof modelRegistryData.whisperModels];
  return entry?.name || modelId || "Whisper";
}

function parakeetModelLabel(modelId: string): string {
  const entry =
    modelRegistryData.parakeetModels[modelId as keyof typeof modelRegistryData.parakeetModels];
  return entry?.name || modelId;
}

function buildCaptureStage(settings: SettingsState): ProcessingRouteStageViewModel {
  const mode = getMicrophoneSelectionMode(settings);
  if (mode === "system") {
    return {
      id: "capture",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.capture.systemMic`,
    };
  }
  if (mode === "built-in") {
    return {
      id: "capture",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.capture.builtInMic`,
    };
  }
  const label = (settings.selectedMicDeviceLabel || "").trim();
  return {
    id: "capture",
    boundary: "onDevice",
    detailKey: label
      ? `${DETAIL_PREFIX}.capture.specificMic`
      : `${DETAIL_PREFIX}.capture.selectedMic`,
    ...(label ? { detailParams: { label } } : {}),
  };
}

function localTranscriptionStage(settings: SettingsState): ProcessingRouteStageViewModel {
  const provider = settings.localTranscriptionProvider;
  if (provider === "nvidia") {
    return {
      id: "transcribe",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.transcribe.parakeet`,
      detailParams: { model: parakeetModelLabel(settings.parakeetModel) },
    };
  }
  if (provider === "cohere") {
    return {
      id: "transcribe",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.transcribe.cohere`,
      detailParams: { model: parakeetModelLabel(settings.cohereModel) },
    };
  }
  return {
    id: "transcribe",
    boundary: "onDevice",
    detailKey: `${DETAIL_PREFIX}.transcribe.whisper`,
    detailParams: { model: whisperModelLabel(settings.whisperModel) },
  };
}

function antigravityTranscriptionDetail(settings: SettingsState): ProcessingRouteStageViewModel {
  const verbatim = settings.antigravityTranscriptionMode === "verbatim";
  return {
    id: "transcribe",
    boundary: "audioLeavesDevice",
    detailKey: verbatim
      ? `${DETAIL_PREFIX}.transcribe.antigravityVerbatim`
      : `${DETAIL_PREFIX}.transcribe.antigravitySmart`,
  };
}

function byokTranscriptionDetail(providerId: string): ProcessingRouteStageViewModel {
  return {
    id: "transcribe",
    boundary: "apiKey",
    detailKey: `${DETAIL_PREFIX}.transcribe.byok`,
    detailParams: { provider: transcriptionProviderName(providerId) },
  };
}

function customTranscriptionDetail(host: string | null): ProcessingRouteStageViewModel {
  return {
    id: "transcribe",
    boundary: "customRoute",
    detailKey: host
      ? `${DETAIL_PREFIX}.transcribe.customHost`
      : `${DETAIL_PREFIX}.transcribe.customUnconfigured`,
    ...(host ? { detailParams: { host } } : {}),
  };
}

function buildTranscribeStage(
  settings: SettingsState,
  route: TranscriptionRoute
): ProcessingRouteStageViewModel {
  if (route.transport === "local") {
    return localTranscriptionStage(settings);
  }
  if (route.transport === "error") {
    return {
      id: "transcribe",
      boundary: "customRoute",
      detailKey: `${DETAIL_PREFIX}.transcribe.misconfigured`,
    };
  }
  if (route.transport === "proxied" && route.provider === "antigravity") {
    return antigravityTranscriptionDetail(settings);
  }
  if (route.transport === "proxied") {
    return byokTranscriptionDetail(route.provider);
  }
  if (route.provider === "self-hosted") {
    const host = endpointHost(settings.remoteTranscriptionUrl);
    return {
      id: "transcribe",
      boundary: "customRoute",
      detailKey: host
        ? `${DETAIL_PREFIX}.transcribe.selfHosted`
        : `${DETAIL_PREFIX}.transcribe.selfHostedUnconfigured`,
      ...(host ? { detailParams: { host } } : {}),
    };
  }
  if (route.provider === "custom") {
    return customTranscriptionDetail(endpointHost(settings.cloudTranscriptionBaseUrl));
  }
  return byokTranscriptionDetail(route.provider);
}

function cleanupBoundaryForMode(mode: InferenceMode, provider: string): ProcessingRouteBoundary {
  if (mode === "local") return "onDevice";
  if (mode === "self-hosted" || mode === "enterprise") return "customRoute";
  if (provider === "antigravity") return "providerRequest";
  if (provider === "custom") return "customRoute";
  if (mode === "openwhispr") return "providerRequest";
  return "apiKey";
}

function cleanupDetailForConfig(
  settings: SettingsState,
  route: TranscriptionRoute,
  mode: InferenceMode,
  provider: string,
  model: string
): ProcessingRouteStageViewModel {
  const boundary = cleanupBoundaryForMode(mode, provider);

  if (!settings.useCleanupModel) {
    return {
      id: "cleanup",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.cleanup.disabled`,
      skipped: true,
    };
  }

  if (
    route.transport === "proxied" &&
    route.provider === "antigravity" &&
    shouldSkipAntigravityDictationCleanup(settings)
  ) {
    return {
      id: "cleanup",
      boundary: "providerRequest",
      detailKey: `${DETAIL_PREFIX}.cleanup.skippedFast`,
      skipped: true,
    };
  }

  if (mode === "local") {
    const localProvider = modelRegistryData.localProviders.find((entry) => entry.id === provider);
    const localModel =
      localProvider?.models.find((entry) => entry.id === model)?.name || model || provider;
    return {
      id: "cleanup",
      boundary,
      detailKey: `${DETAIL_PREFIX}.cleanup.local`,
      detailParams: { model: localModel },
    };
  }

  if (mode === "self-hosted") {
    const host = endpointHost(settings.cleanupRemoteUrl);
    return {
      id: "cleanup",
      boundary,
      detailKey: host
        ? `${DETAIL_PREFIX}.cleanup.selfHosted`
        : `${DETAIL_PREFIX}.cleanup.selfHostedUnconfigured`,
      ...(host ? { detailParams: { host } } : {}),
    };
  }

  if (mode === "enterprise") {
    return {
      id: "cleanup",
      boundary,
      detailKey: `${DETAIL_PREFIX}.cleanup.enterprise`,
      detailParams: { provider: cloudProviderName(provider) },
    };
  }

  if (provider === "antigravity") {
    const polished = settings.antigravityDictationMode === "polished";
    return {
      id: "cleanup",
      boundary,
      detailKey: polished
        ? `${DETAIL_PREFIX}.cleanup.antigravityPolished`
        : `${DETAIL_PREFIX}.cleanup.antigravityFast`,
    };
  }

  if (provider === "custom") {
    const host = endpointHost(settings.cleanupCloudBaseUrl);
    return {
      id: "cleanup",
      boundary,
      detailKey: host
        ? `${DETAIL_PREFIX}.cleanup.customHost`
        : `${DETAIL_PREFIX}.cleanup.customUnconfigured`,
      ...(host ? { detailParams: { host } } : {}),
    };
  }

  if (mode === "openwhispr" || selectIsCloudCleanupMode(settings)) {
    return {
      id: "cleanup",
      boundary,
      detailKey: `${DETAIL_PREFIX}.cleanup.cloud`,
    };
  }

  return {
    id: "cleanup",
    boundary,
    detailKey: `${DETAIL_PREFIX}.cleanup.byok`,
    detailParams: { provider: cloudProviderName(provider) },
  };
}

function buildDeliveryStage(settings: SettingsState): ProcessingRouteStageViewModel {
  if (settings.autoPasteEnabled) {
    return {
      id: "delivery",
      boundary: "onDevice",
      detailKey: `${DETAIL_PREFIX}.delivery.paste`,
    };
  }
  return {
    id: "delivery",
    boundary: "onDevice",
    detailKey: `${DETAIL_PREFIX}.delivery.clipboardOnly`,
  };
}

export function buildConfiguredProcessingRouteViewModel({
  settings,
  policy = null,
}: ConfiguredProcessingRouteInput): ConfiguredProcessingRouteViewModel {
  const route = resolveTranscriptionRoute({
    settings: {
      transcriptionMode: settings.transcriptionMode,
      useLocalWhisper: settings.useLocalWhisper,
      remoteTranscriptionUrl: settings.remoteTranscriptionUrl,
      remoteTranscriptionModel: settings.remoteTranscriptionModel,
      cloudTranscriptionProvider: settings.cloudTranscriptionProvider,
      cloudTranscriptionModel: settings.cloudTranscriptionModel,
      cloudTranscriptionBaseUrl: settings.cloudTranscriptionBaseUrl,
      cortiEnvironment: settings.cortiEnvironment,
      cortiTenant: settings.cortiTenant,
      preferredLanguage: settings.preferredLanguage,
    },
    policy,
    providers: modelRegistryData.transcriptionProviders,
  });

  const cleanup = selectResolvedLLMConfig(settings, "dictationCleanup");

  return {
    policyManaged: policy?.status === "managed",
    stages: [
      buildCaptureStage(settings),
      buildTranscribeStage(settings, route),
      cleanupDetailForConfig(settings, route, cleanup.mode, cleanup.provider, cleanup.model),
      buildDeliveryStage(settings),
    ],
  };
}
