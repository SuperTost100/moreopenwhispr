const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function load(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-configured-route-test-",
  });
  const routeModel = await vite.ssrLoadModule(
    "/components/control-panel/configuredProcessingRouteModel.ts"
  );
  const settingsStore = await vite.ssrLoadModule("/stores/settingsStore.ts");
  return {
    buildConfiguredProcessingRouteViewModel:
      routeModel.buildConfiguredProcessingRouteViewModel,
    selectPolicyEffectiveSettings: settingsStore.selectPolicyEffectiveSettings,
  };
}

function baseSettings(overrides = {}) {
  return {
    transcriptionMode: "providers",
    useLocalWhisper: false,
    remoteTranscriptionUrl: "",
    remoteTranscriptionModel: "",
    cloudTranscriptionProvider: "antigravity",
    cloudTranscriptionModel: "gemini-3.5-transcribe",
    cloudTranscriptionBaseUrl: "",
    cortiEnvironment: "us",
    cortiTenant: "base",
    language: "en",
    preferredLanguage: "auto",
    localTranscriptionProvider: "whisper",
    whisperModel: "base",
    parakeetModel: "parakeet-tdt-0.6b-v3",
    cohereModel: "cohere-transcribe-03-2026",
    antigravityDictationMode: "fast",
    antigravityTranscriptionMode: "smart",
    useCleanupModel: true,
    cleanupMode: "providers",
    cleanupProvider: "antigravity",
    cleanupModel: "gemini-3.5-flash-medium",
    cleanupCloudMode: "byok",
    cleanupCloudBaseUrl: "",
    cleanupRemoteUrl: "",
    autoPasteEnabled: true,
    microphoneSelectionMode: "specific",
    selectedMicDeviceId: "mic-1",
    selectedMicDeviceLabel: "Elgato Wave:3",
    preferBuiltInMic: false,
    isSignedIn: false,
    enterpriseSetupMode: "byok",
    ...overrides,
  };
}

function stage(model, id) {
  return model.stages.find((entry) => entry.id === id);
}

test("local Whisper route keeps transcription on device", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useLocalWhisper: true,
      transcriptionMode: "local",
      localTranscriptionProvider: "whisper",
      whisperModel: "small",
    }),
  });

  assert.equal(stage(model, "transcribe").boundary, "onDevice");
  assert.match(stage(model, "transcribe").detailKey, /whisper$/);
  assert.equal(stage(model, "transcribe").detailParams.model, "Small");
});

test("local Parakeet and Cohere routes stay on device", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);

  const parakeet = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useLocalWhisper: true,
      transcriptionMode: "local",
      localTranscriptionProvider: "nvidia",
      parakeetModel: "parakeet-tdt-0.6b-v3",
    }),
  });
  assert.equal(stage(parakeet, "transcribe").boundary, "onDevice");
  assert.match(stage(parakeet, "transcribe").detailKey, /parakeet$/);

  const cohere = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useLocalWhisper: true,
      transcriptionMode: "local",
      localTranscriptionProvider: "cohere",
      cohereModel: "cohere-transcribe-03-2026",
    }),
  });
  assert.equal(stage(cohere, "transcribe").boundary, "onDevice");
  assert.match(stage(cohere, "transcribe").detailKey, /cohere$/);
});

test("Antigravity fast smart mode skips cleanup and marks audio leaving device", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      cloudTranscriptionProvider: "antigravity",
      antigravityDictationMode: "fast",
      antigravityTranscriptionMode: "smart",
      useCleanupModel: true,
    }),
  });

  assert.equal(stage(model, "transcribe").boundary, "audioLeavesDevice");
  assert.match(stage(model, "transcribe").detailKey, /antigravitySmart$/);
  assert.equal(stage(model, "cleanup").skipped, true);
  assert.match(stage(model, "cleanup").detailKey, /skippedFast$/);
});

test("Antigravity verbatim transcription uses the verbatim detail key", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      cloudTranscriptionProvider: "antigravity",
      antigravityTranscriptionMode: "verbatim",
      antigravityDictationMode: "polished",
    }),
  });

  assert.match(stage(model, "transcribe").detailKey, /antigravityVerbatim$/);
});

test("local route with stale Antigravity provider does not skip cleanup", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useLocalWhisper: true,
      transcriptionMode: "local",
      localTranscriptionProvider: "whisper",
      whisperModel: "base",
      cloudTranscriptionProvider: "antigravity",
      cloudTranscriptionModel: "gemini-3.5-transcribe",
      antigravityDictationMode: "fast",
      antigravityTranscriptionMode: "smart",
      useCleanupModel: true,
      cleanupProvider: "openai",
      cleanupMode: "providers",
    }),
  });

  assert.equal(stage(model, "transcribe").boundary, "onDevice");
  assert.notEqual(stage(model, "cleanup").skipped, true);
  assert.doesNotMatch(stage(model, "cleanup").detailKey, /skippedFast$/);
});

test("Antigravity polished mode keeps cleanup as a provider request", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      cloudTranscriptionProvider: "antigravity",
      antigravityDictationMode: "polished",
      antigravityTranscriptionMode: "smart",
      cleanupProvider: "antigravity",
    }),
  });

  assert.equal(stage(model, "cleanup").boundary, "providerRequest");
  assert.match(stage(model, "cleanup").detailKey, /antigravityPolished$/);
  assert.notEqual(stage(model, "cleanup").skipped, true);
});

test("BYOK OpenAI transcription uses api key boundary without exposing secrets", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      cloudTranscriptionProvider: "openai",
      cloudTranscriptionModel: "gpt-4o-mini-transcribe",
      openaiApiKey: "sk-secret",
    }),
  });

  assert.equal(stage(model, "transcribe").boundary, "apiKey");
  assert.equal(stage(model, "transcribe").detailParams.provider, "OpenAI");
  assert.equal(JSON.stringify(model).includes("sk-secret"), false);
});

test("self-hosted and custom routes expose hostnames only", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);

  const selfHosted = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      transcriptionMode: "self-hosted",
      remoteTranscriptionUrl: "https://stt.internal.example.com/v1?token=secret",
      remoteTranscriptionModel: "whisper-1",
      useLocalWhisper: false,
    }),
  });
  assert.equal(stage(selfHosted, "transcribe").boundary, "customRoute");
  assert.equal(stage(selfHosted, "transcribe").detailParams.host, "stt.internal.example.com");
  assert.equal(JSON.stringify(selfHosted).includes("secret"), false);

  const custom = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      cloudTranscriptionProvider: "custom",
      cloudTranscriptionBaseUrl: "https://api.parasail.example.com/v1/audio",
      cloudTranscriptionModel: "whisper-1",
    }),
  });
  assert.equal(stage(custom, "transcribe").boundary, "customRoute");
  assert.equal(stage(custom, "transcribe").detailParams.host, "api.parasail.example.com");
});

test("cleanup self-hosted route strips query secrets from the hostname detail", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useLocalWhisper: true,
      transcriptionMode: "local",
      localTranscriptionProvider: "whisper",
      cleanupMode: "self-hosted",
      cleanupRemoteUrl: "https://llm.internal.example.com/v1?api_key=super-secret",
      cleanupProvider: "custom",
      cleanupModel: "llama-3",
    }),
  });

  assert.equal(stage(model, "cleanup").detailParams.host, "llm.internal.example.com");
  assert.equal(JSON.stringify(model).includes("super-secret"), false);
});

test("cleanup disabled and clipboard-only delivery are reflected", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      useCleanupModel: false,
      autoPasteEnabled: false,
    }),
  });

  assert.equal(stage(model, "cleanup").skipped, true);
  assert.match(stage(model, "cleanup").detailKey, /disabled$/);
  assert.match(stage(model, "delivery").detailKey, /clipboardOnly$/);
});

test("managed policy marks the view model as policy managed", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({ cloudTranscriptionProvider: "openai" }),
    policy: {
      status: "managed",
      appVersion: "1.9.3",
      policy: {
        version: 1,
        transcription: { allowedModes: ["providers"], allowedByokProviders: ["openai"] },
        llm: {
          allowedModes: ["providers"],
          allowedByokProviders: ["openai"],
          allowedEnterpriseProviders: [],
        },
        features: { agentEnabled: true, webSearchEnabled: true },
        sharing: { externalLinkSharing: "allowed" },
        dataRetention: {
          audioRetentionMaxDays: null,
          localHistoryMode: "user_choice",
          cloudBackupAllowed: true,
        },
        minAppVersion: null,
      },
    },
  });

  assert.equal(model.policyManaged, true);
  assert.equal(model.stages.length, 4);
});

test("selectPolicyEffectiveSettings overrides cloud Antigravity to local for the route", async (t) => {
  const { buildConfiguredProcessingRouteViewModel, selectPolicyEffectiveSettings } = await load(t);

  const policy = {
    status: "managed",
    appVersion: "1.9.3",
    policy: {
      version: 1,
      transcription: { allowedModes: ["local"], allowedByokProviders: [] },
      llm: {
        allowedModes: ["providers"],
        allowedByokProviders: ["openai"],
        allowedEnterpriseProviders: [],
      },
      features: { agentEnabled: true, webSearchEnabled: true },
      sharing: { externalLinkSharing: "allowed" },
      dataRetention: {
        audioRetentionMaxDays: null,
        localHistoryMode: "user_choice",
        cloudBackupAllowed: true,
      },
      minAppVersion: null,
    },
  };

  const raw = baseSettings({
    useLocalWhisper: false,
    transcriptionMode: "providers",
    cloudTranscriptionProvider: "antigravity",
    antigravityDictationMode: "fast",
    antigravityTranscriptionMode: "smart",
    useCleanupModel: true,
  });
  const effective = selectPolicyEffectiveSettings(raw, policy);

  assert.equal(effective.useLocalWhisper, true);
  assert.equal(effective.transcriptionMode, "local");

  const model = buildConfiguredProcessingRouteViewModel({
    settings: effective,
    policy,
  });

  assert.equal(stage(model, "transcribe").boundary, "onDevice");
  assert.notEqual(stage(model, "cleanup").skipped, true);
  assert.doesNotMatch(stage(model, "cleanup").detailKey, /skippedFast$/);
});

test("misconfigured self-hosted route fails closed without naming a provider", async (t) => {
  const { buildConfiguredProcessingRouteViewModel } = await load(t);
  const model = buildConfiguredProcessingRouteViewModel({
    settings: baseSettings({
      transcriptionMode: "self-hosted",
      remoteTranscriptionUrl: "",
      useLocalWhisper: false,
      cloudTranscriptionProvider: "openai",
    }),
  });

  const transcribe = stage(model, "transcribe");
  assert.equal(transcribe.boundary, "customRoute");
  assert.match(transcribe.detailKey, /misconfigured$/);
  assert.equal(transcribe.detailParams?.provider, undefined);
});
