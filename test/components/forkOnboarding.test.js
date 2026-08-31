"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  createOnboardingSession,
  getOnboardingRoute,
} = require("../../src/components/onboarding/flow.ts");

describe("fork onboarding route", () => {
  it("starts at permissions without a preset setup mode", () => {
    const session = createOnboardingSession();
    assert.equal(session.authPath, "guest");
    assert.equal(session.setupMode, null);
    assert.equal(session.currentStepId, "permissions");
  });

  it("includes setup-choice after permissions and hotkeys", () => {
    const route = getOnboardingRoute({
      authPath: "guest",
      setupMode: null,
      agentAllowed: true,
    });
    assert.deepEqual(route, [
      "permissions",
      "dictation-hotkey",
      "activation-mode",
      "setup-choice",
    ]);
  });

  it("appends local provider steps after setup-choice", () => {
    const route = getOnboardingRoute({
      authPath: "guest",
      setupMode: "local",
      agentAllowed: true,
    });
    assert.deepEqual(route, [
      "permissions",
      "dictation-hotkey",
      "activation-mode",
      "setup-choice",
      "local-dictation",
      "local-assistant",
    ]);
  });
});
