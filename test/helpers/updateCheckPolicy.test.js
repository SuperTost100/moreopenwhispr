const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/updateCheckPolicy.js");

test("MOW update feed points at the fork, not OpenWhispr/openwhispr", async () => {
  const { githubUpdateFeed } = await load();
  const { MOW_PROFILE } = require("../../src/config/mowProfile.cjs");

  assert.deepEqual(githubUpdateFeed(), {
    provider: "github",
    owner: MOW_PROFILE.githubOwner,
    repo: MOW_PROFILE.githubRepo,
    private: false,
  });
  assert.notEqual(githubUpdateFeed().owner, "OpenWhispr");
  assert.notEqual(githubUpdateFeed().repo, "openwhispr");
});
