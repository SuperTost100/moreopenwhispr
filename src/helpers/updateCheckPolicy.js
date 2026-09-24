// Points the auto-updater at the right GitHub release feed. Upstream OpenWhispr
// publishes its own releases; MoreOpenWhisperer publishes to its own fork repo
// (SuperTost100), so this can't be a hardcoded owner/repo.
const { MOW_PROFILE, isMowBuild } = require("../config/mowProfile.cjs");

function githubUpdateFeed() {
  const mow = isMowBuild();
  const owner = mow ? MOW_PROFILE.githubOwner : "OpenWhispr";
  const repo = mow ? MOW_PROFILE.githubRepo : "openwhispr";
  return { provider: "github", owner, repo, private: false };
}

module.exports = { githubUpdateFeed };
