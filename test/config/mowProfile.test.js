"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MOW_PROFILE,
  MOW_ACCOUNT_MODES,
  isMowBuild,
  withoutAccountModes,
  coerceInferenceMode,
  mowRepoUrl,
} = require("../../src/config/mowProfile.js");

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
    assert.equal(mowRepoUrl(), MOW_PROFILE.repoUrl);
    assert.match(mowRepoUrl("issues"), /\/issues$/);
  });
});
