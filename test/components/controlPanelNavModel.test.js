const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/components/control-panel/controlPanelNavModel.ts");

test("home uses dictation label key while keeping home id", async () => {
  const { CONTROL_PANEL_NAV_ITEMS, getControlPanelNavLabelKey } = await load();
  const home = CONTROL_PANEL_NAV_ITEMS.find((item) => item.id === "home");

  assert.ok(home);
  assert.equal(home.labelKey, "sidebar.dictation");
  assert.equal(getControlPanelNavLabelKey("home"), "sidebar.dictation");
});

test("getAllowedControlPanelNavItems applies agent and policy gates", async () => {
  const { getAllowedControlPanelNavItems } = await load();

  const none = getAllowedControlPanelNavItems({
    agentAllowed: false,
    policyActionsAllowed: false,
  });
  assert.deepEqual(
    none.map((item) => item.id),
    ["home", "personal-notes", "dictionary", "integrations"]
  );

  const agentOnly = getAllowedControlPanelNavItems({
    agentAllowed: true,
    policyActionsAllowed: false,
  });
  assert.deepEqual(agentOnly.map((item) => item.id), [
    "home",
    "chat",
    "personal-notes",
    "dictionary",
    "integrations",
  ]);

  const policyOnly = getAllowedControlPanelNavItems({
    agentAllowed: false,
    policyActionsAllowed: true,
  });
  assert.deepEqual(policyOnly.map((item) => item.id), [
    "home",
    "personal-notes",
    "upload",
    "dictionary",
    "integrations",
  ]);

  const all = getAllowedControlPanelNavItems({
    agentAllowed: true,
    policyActionsAllowed: true,
  });
  assert.deepEqual(all.map((item) => item.id), [
    "home",
    "chat",
    "personal-notes",
    "upload",
    "dictionary",
    "integrations",
  ]);
});

test("getControlPanelNavLabelKey labels the settings view, which has no nav item", async () => {
  const { getControlPanelNavLabelKey } = await load();
  assert.equal(getControlPanelNavLabelKey("settings"), "sidebar.settings");
});

test("getControlPanelNavLabelKey never mislabels an unknown view as another tab", async () => {
  const { getControlPanelNavLabelKey } = await load();
  assert.equal(getControlPanelNavLabelKey("missing"), "common.unknown");
});
