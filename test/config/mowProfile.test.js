"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MOW_ACCOUNT_MODES,
  isMowBuild,
  withoutAccountModes,
  coerceInferenceMode,
  mowRepoUrl,
} = require("../../src/config/mowProfile.cjs");

describe("mowProfile", () => {
  it("MOW build strips account cloud modes", () => {
    assert.equal(isMowBuild(), true);
    assert.ok(MOW_ACCOUNT_MODES.has("openwhispr"));
    assert.deepEqual(
      withoutAccountModes([
        { id: "openwhispr", label: "cloud" },
        { id: "providers", label: "byok" },
      ]).map((m) => m.id),
      ["providers"]
    );
    assert.equal(coerceInferenceMode("openwhispr"), "providers");
  });

  it("mowRepoUrl joins repo base and path", () => {
    assert.equal(mowRepoUrl(), "https://github.com/SuperTost100/openwhispr");
    assert.match(mowRepoUrl("issues"), /\/issues$/);
  });
});
