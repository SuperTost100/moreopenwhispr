"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { MOW_DISABLED_CHANNELS } = require("../../src/helpers/mowAccountIpc.js");

describe("mowAccountIpc", () => {
  it("lists core account and cloud invoke channels", () => {
    assert.ok(MOW_DISABLED_CHANNELS.includes("auth-set-token"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("cloud-transcribe"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("get-workspace-policy"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("broadcast-sync-event"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("get-stt-config"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("get-note-recording-config"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("get-referral-stats"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("send-referral-invite"));
    assert.ok(MOW_DISABLED_CHANNELS.includes("get-referral-invites"));
  });
});
