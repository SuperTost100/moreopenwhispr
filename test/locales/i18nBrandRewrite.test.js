const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// M07: on a MoreOpenWhisperer (mow) build, the fork disclosure line is
// supposed to name the real upstream project ("OpenWhispr"), not the fork
// itself. i18n.ts used to run the brand rewrite as an i18next postProcess
// step on the fully interpolated string, which also rewrote the
// "upstreamName" interpolation value passed in at the call site. Fixed by
// rewriting the translation resources once at load, before interpolation,
// so an interpolated value is never touched while hardcoded brand mentions
// baked into the resource JSON still are.
test("the fork disclosure names the real upstream project, not the fork", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-i18n-brand-test-",
  });

  const { isMowBuild, MOW_PROFILE } = await vite.ssrLoadModule("/config/mowProfile.ts");
  assert.equal(isMowBuild(), true);

  const mod = await vite.ssrLoadModule("/i18n.ts");
  const i18n = mod.default;

  const disclosure = i18n.t("controlPanel.shell.forkDisclosureUnofficial", {
    upstreamName: MOW_PROFILE.upstreamName,
  });
  assert.equal(disclosure, "Unofficial OpenWhispr fork.");

  // A plain resource string with a hardcoded upstream mention (no
  // interpolation) must still be rewritten to the fork's own product name.
  const tooltip = i18n.t("tray.tooltip");
  assert.match(tooltip, new RegExp(`^${MOW_PROFILE.productName}`));
  assert.equal(tooltip.startsWith(MOW_PROFILE.upstreamName), false);
});
