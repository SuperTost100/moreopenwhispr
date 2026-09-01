"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  MOW_ACCOUNT_MODES,
  MOW_PROFILE,
  isMowBuild,
  withoutAccountModes,
  coerceInferenceMode,
  mowRepoUrl,
  rewriteUpstreamBrand,
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
    assert.equal(mowRepoUrl(), MOW_PROFILE.repoUrl);
    assert.equal(
      MOW_PROFILE.repoUrl,
      `https://github.com/${MOW_PROFILE.githubOwner}/${MOW_PROFILE.githubRepo}`
    );
    assert.equal(MOW_PROFILE.issuesUrl, `${MOW_PROFILE.repoUrl}/issues`);
    assert.match(mowRepoUrl("issues"), /\/issues$/);
    assert.equal(rewriteUpstreamBrand("OpenWhispr dictation"), "MoreOpenWhispr dictation");
    assert.equal(rewriteUpstreamBrand(12), 12);
  });

  // mowProfile.cjs is a hand-maintained mirror of mowProfile.ts (main process
  // can't require the .ts). Nothing but this test stops the two drifting, and a
  // drift is a user-visible branding bug: main and renderer would disagree.
  it("the .cjs mirror matches mowProfile.ts", async () => {
    const ts = await import("../../src/config/mowProfile.ts");
    const cjs = require("../../src/config/mowProfile.cjs");

    for (const name of Object.keys(cjs)) {
      assert.ok(name in ts, `mowProfile.ts is missing ${name}`);
    }

    assert.deepEqual(ts.MOW_PROFILE, cjs.MOW_PROFILE);
    assert.deepEqual([...ts.MOW_ACCOUNT_MODES], [...cjs.MOW_ACCOUNT_MODES]);
    assert.equal(ts.isMowBuild(), cjs.isMowBuild());
    assert.equal(ts.mowRepoUrl("issues"), cjs.mowRepoUrl("issues"));
    assert.equal(ts.coerceInferenceMode("openwhispr"), cjs.coerceInferenceMode("openwhispr"));
    assert.equal(ts.coerceCloudMode("openwhispr"), cjs.coerceCloudMode("openwhispr"));
    assert.equal(
      ts.rewriteUpstreamBrand("OpenWhispr and OpenWhispr"),
      cjs.rewriteUpstreamBrand("OpenWhispr and OpenWhispr")
    );
    assert.deepEqual(
      ts.withoutAccountModes([{ id: "openwhispr" }, { id: "providers" }]),
      cjs.withoutAccountModes([{ id: "openwhispr" }, { id: "providers" }])
    );
  });
});
