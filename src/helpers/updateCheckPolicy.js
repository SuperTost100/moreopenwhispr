// The "App updates" toggle gates the automatic checks themselves, not just the
// popup: with it off the app must not reach the update feed, so offline or
// firewalled machines never surface a connection error dialog (#1605).
// Only an explicit false disables — missing prefs (renderer sync not arrived
// yet) keep check-by-default behavior.
const { MOW_PROFILE, isMowBuild } = require("../config/mowProfile.cjs");

function appUpdatesEnabled({ notificationsEnabled, notifyUpdates } = {}) {
  return notificationsEnabled !== false && notifyUpdates !== false;
}

function githubUpdateFeed() {
  const mow = isMowBuild();
  const owner = mow ? MOW_PROFILE.githubOwner : "OpenWhispr";
  const repo = mow ? MOW_PROFILE.githubRepo : "openwhispr";
  return { provider: "github", owner, repo, private: false };
}

module.exports = { appUpdatesEnabled, githubUpdateFeed };
