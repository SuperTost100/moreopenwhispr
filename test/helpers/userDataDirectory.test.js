"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LEGACY_MOW_USER_DATA_DIRECTORY,
  resolveUserDataDirectoryName,
} = require("../../src/helpers/userDataDirectory.js");

describe("userData directory compatibility", () => {
  it("pins the legacy MOW production folder name", () => {
    assert.equal(LEGACY_MOW_USER_DATA_DIRECTORY, "MoreOpenWhispr");
  });

  it("keeps the legacy directory for production MOW builds", () => {
    assert.equal(
      resolveUserDataDirectoryName({ isMowBuild: true, channel: "production" }),
      LEGACY_MOW_USER_DATA_DIRECTORY
    );
  });

  it("keeps isolated upstream-named directories for non-production channels", () => {
    assert.equal(
      resolveUserDataDirectoryName({ isMowBuild: true, channel: "development" }),
      "OpenWhispr-development"
    );
    assert.equal(
      resolveUserDataDirectoryName({ isMowBuild: true, channel: "staging" }),
      "OpenWhispr-staging"
    );
  });

  it("leaves upstream production on Electron's default directory", () => {
    assert.equal(
      resolveUserDataDirectoryName({ isMowBuild: false, channel: "production" }),
      null
    );
    assert.equal(
      resolveUserDataDirectoryName({ isMowBuild: false, channel: "development" }),
      "OpenWhispr-development"
    );
  });
});
