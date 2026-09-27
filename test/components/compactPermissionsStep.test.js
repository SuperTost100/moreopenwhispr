const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// M08: at the compact onboarding window size (480x624,
// src/helpers/windowConfig.js ONBOARDING_WINDOW_SIZES.COMPACT), the first-run
// title wrapped to three lines on a MOW build ("Set up MoreOpenWhisperer in 3
// minutes") because the heading was capped at max-w-72 (288px) — a width sized
// for the shorter upstream "OpenWhispr" title, not the fork's longer product
// name. The fix drops that width cap so the heading uses the full content
// width and wraps to two lines (confirmed by screenshot at 480x624 in English
// and German; see mow-work/audit-fix/M08). This test pins the structural root
// cause: the heading must not carry a max-width utility narrower than its
// flex-column parent.
async function loadCompactPermissionsStep(t) {
  installBrowserGlobals(t, { window: { electronAPI: {} } });
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-compact-permissions-step-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        export function useTranslation() {
          return { t(key) { return key; } };
        }
      `,
      "onboarding-permission-microphone.webp": `export default "mic.webp";`,
      "onboarding-permission-accessibility.webp": `export default "accessibility.webp";`,
      "onboarding-permission-system-audio.webp": `export default "system-audio.webp";`,
    },
  });
  const { default: CompactPermissionsStep } = await vite.ssrLoadModule(
    "/components/onboarding/CompactPermissionsStep.tsx"
  );
  return CompactPermissionsStep;
}

const noopPermissions = {
  micPermissionGranted: false,
  micPermissionError: null,
  requestMicPermission: async () => {},
  accessibilityPermissionGranted: false,
  requestAccessibilityPermission: async () => {},
  pasteToolsInfo: null,
  isCheckingPasteTools: false,
  checkPasteToolsAvailability: async () => {},
  openSoundInputSettings: async () => {},
  openMicPrivacySettings: async () => {},
};

const noopSystemAudio = {
  granted: false,
  mode: "unsupported",
  supportsOnboardingGrant: false,
  request: async () => false,
};

test("the first-run title has no width cap narrower than its container", async (t) => {
  const CompactPermissionsStep = await loadCompactPermissionsStep(t);
  const markup = renderToStaticMarkup(
    React.createElement(CompactPermissionsStep, {
      permissions: noopPermissions,
      systemAudio: noopSystemAudio,
      onContinue: () => {},
    })
  );

  const h1Match = markup.match(/<h1[^>]*class="([^"]*)"[^>]*>/);
  assert.ok(h1Match, "expected an <h1> title in the permissions step markup");
  const h1ClassName = h1Match[1];

  // The bug: a Tailwind max-w-* utility (e.g. max-w-72, sized for the shorter
  // upstream title) forced a long fork product name onto its own line.
  assert.doesNotMatch(
    h1ClassName,
    /\bmax-w-\d/,
    `title heading must not cap its width below the container: className was "${h1ClassName}"`
  );
});
