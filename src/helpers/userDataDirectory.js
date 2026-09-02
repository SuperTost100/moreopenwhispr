"use strict";

const LEGACY_MOW_USER_DATA_DIRECTORY = "MoreOpenWhispr";

/**
 * Resolve the directory name used for Electron's userData path.
 *
 * Production MOW builds retain the old directory so existing users keep their
 * settings and credentials. Non-production channels intentionally retain the
 * upstream channel names, while upstream production leaves Electron's
 * platform-default path untouched.
 */
function resolveUserDataDirectoryName({ isMowBuild, channel }) {
  if (channel !== "production") {
    return `OpenWhispr-${channel}`;
  }

  return isMowBuild ? LEGACY_MOW_USER_DATA_DIRECTORY : null;
}

module.exports = {
  LEGACY_MOW_USER_DATA_DIRECTORY,
  resolveUserDataDirectoryName,
};
