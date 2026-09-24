"use strict";

const { ipcMain } = require("electron");
const { isMowBuild } = require("../config/mowProfile.cjs");

const DISABLED = Object.freeze({
  success: false,
  error: "OpenWhispr Cloud accounts are disabled in MoreOpenWhisperer",
  code: "MOW_ACCOUNTS_DISABLED",
});

/** Account / cloud IPC invoke channels replaced after the full handler setup. */
const MOW_DISABLED_CHANNELS = [
  "set-active-account-scope",
  "delete-account-data",
  "auth-clear-session",
  "auth-get-token",
  "auth-get-token-state",
  "auth-set-token",
  "cloud-transcribe",
  "cloud-health-check",
  "cloud-reason",
  "cloud-usage",
  "cloud-streaming-usage",
  "cloud-checkout",
  "cloud-billing-portal",
  "cloud-switch-plan",
  "cloud-preview-switch",
  "cloud-api-request",
  "get-workspace-policy",
  "get-managed-enterprise-config",
  "clear-managed-enterprise-identity",
  "transcribe-audio-file-cloud",
  "broadcast-sync-event",
  "get-stt-config",
  "get-note-recording-config",
  "get-referral-stats",
  "send-referral-invite",
  "get-referral-invites",
  // Cloud sync of locally-recorded analytics events (account-scoped claim/
  // upload queue) — an OpenWhispr Cloud account feature. Local recording
  // (analytics-record-event, analytics-get-summary) stays enabled since it
  // never leaves the device.
  "analytics-get-pending",
  "analytics-mark-synced",
  "analytics-get-pending-deletes",
  "analytics-hard-delete",
  "analytics-get-pending-clear",
  "analytics-complete-clear",
  "analytics-count-unclaimed",
  "analytics-count-awaiting-upload",
  "analytics-claim-anonymous",
];

/** Fire-and-forget cloud channels silenced in MOW builds. */
const MOW_DISABLED_ON_CHANNELS = [
  "cloud-transcribe-cancel",
  "cloud-reason-cancel",
  "cloud-agent-stream-start",
  "cloud-agent-stream-cancel",
];

function registerMowAccountIpcOverrides() {
  if (!isMowBuild()) return;
  for (const channel of MOW_DISABLED_CHANNELS) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async () => DISABLED);
  }
  for (const channel of MOW_DISABLED_ON_CHANNELS) {
    // ponytail: tests stub ipcMain without EventEmitter. Electron always has this.
    ipcMain.removeAllListeners?.(channel);
    ipcMain.on(channel, () => {});
  }
}

module.exports = { registerMowAccountIpcOverrides, MOW_DISABLED_CHANNELS };
