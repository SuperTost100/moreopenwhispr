const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

function installNavigatorLanguage(t, language) {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { language, languages: [language] },
  });
  t.after(() => {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  });
}

function loadEnvironmentManager(t, userDataDirectory) {
  const originalLoad = Module._load;
  const environmentPath = require.resolve("../../src/helpers/environment");
  delete require.cache[environmentPath];

  Module._load = function loadWithElectronStub(request, parent, isMain) {
    if (request === "electron") {
      return {
        app: {
          getPath: () => userDataDirectory,
          getAppPath: () => userDataDirectory,
          isReady: () => false,
        },
        safeStorage: {
          isEncryptionAvailable: () => false,
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require("../../src/helpers/environment");
  } finally {
    Module._load = originalLoad;
    t.after(() => delete require.cache[environmentPath]);
  }
}

test("fresh Chinese browser locale survives settings hydration", async (t) => {
  installNavigatorLanguage(t, "zh-Hans-CN");
  installBrowserGlobals(t, {
    initialStorage: {
      customDictionary: JSON.stringify(["OpenWhispr"]),
    },
    window: {
      electronAPI: {
        getDictionary: async () => ["OpenWhispr"],
        getUiLanguage: async () => "",
        setDictionary: async () => ({ success: true }),
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-ui-language-startup-test-",
  });

  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");
  const { initializeSettings, useSettingsStore } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const initialLanguage = i18n.language;
  const initialStoreLanguage = useSettingsStore.getState().uiLanguage;

  await initializeSettings();

  assert.deepEqual(
    {
      initialLanguage,
      initialStoreLanguage,
      hydratedLanguage: i18n.language,
      hydratedStoreLanguage: useSettingsStore.getState().uiLanguage,
      persistedLanguage: localStorage.getItem("uiLanguage"),
    },
    {
      initialLanguage: "zh-CN",
      initialStoreLanguage: "zh-CN",
      hydratedLanguage: "zh-CN",
      hydratedStoreLanguage: "zh-CN",
      persistedLanguage: null,
    }
  );
});

test("BYOK secrets hydrate from the main process on a MOW (account-free) build", async (t) => {
  installNavigatorLanguage(t, "en-US");
  installBrowserGlobals(t, {
    window: {
      electronAPI: {
        getDictionary: async () => [],
        getUiLanguage: async () => "",
        setDictionary: async () => ({ success: true }),
        getOpenAIKey: async () => "sk-test-openai",
        getAnthropicKey: async () => "sk-test-anthropic",
      },
    },
  });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-byok-hydration-test-",
  });

  const { initializeSettings, useSettingsStore } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  const { isMowBuild } = await vite.ssrLoadModule("/config/mowProfile.ts");

  await initializeSettings();
  // initializeSettings fires a background i18n.changeLanguage() that isn't
  // awaited; let it settle before the harness tears down the Vite SSR
  // transport, or node:test attributes its late rejection to this test.
  await new Promise((resolve) => setTimeout(resolve, 300));

  // This fork is always a MOW build; asserting it here documents the
  // assumption the gate previously (incorrectly) relied on.
  assert.equal(isMowBuild(), true);

  assert.deepEqual(
    {
      openaiApiKey: useSettingsStore.getState().openaiApiKey,
      anthropicApiKey: useSettingsStore.getState().anthropicApiKey,
    },
    {
      openaiApiKey: "sk-test-openai",
      anthropicApiKey: "sk-test-anthropic",
    }
  );
});

test("main locale fallback remains implicit and yields to an explicit preference", (t) => {
  const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-ui-language-"));
  const originalEnvironment = { ...process.env };
  const originalResourcesPath = process.resourcesPath;
  process.resourcesPath = userDataDirectory;
  delete process.env.UI_LANGUAGE;
  t.after(() => {
    process.env = originalEnvironment;
    process.resourcesPath = originalResourcesPath;
    fs.rmSync(userDataDirectory, { recursive: true, force: true });
  });

  const EnvironmentManager = loadEnvironmentManager(t, userDataDirectory);
  const environmentManager = new EnvironmentManager();
  const unsetLanguage = environmentManager.getUiLanguage();
  const detectedLanguage = environmentManager.getUiLanguage("zh-Hant-TW");
  const environmentAfterDetection = process.env.UI_LANGUAGE;

  process.env.UI_LANGUAGE = "de-DE";
  const explicitLanguage = environmentManager.getUiLanguage("zh-Hant-TW");

  assert.deepEqual(
    { unsetLanguage, detectedLanguage, environmentAfterDetection, explicitLanguage },
    {
      unsetLanguage: "",
      detectedLanguage: "zh-TW",
      environmentAfterDetection: undefined,
      explicitLanguage: "de",
    }
  );
});
