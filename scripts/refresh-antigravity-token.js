#!/usr/bin/env node
"use strict";

// Force-refresh ~/.gemini/antigravity-cli/antigravity-oauth-token.
//
// The desktop app keeps this token fresh on its own while it's running (a
// keepalive timer refreshes it ~5 minutes before expiry, and resumes right
// away on wake from sleep), so wiring this into a LaunchAgent/cron job is
// optional — useful mainly for headless use (e.g. the CLI bridge) when the
// desktop app isn't running continuously.
const { getAntigravityAccessToken } = require("../src/helpers/antigravityAuth");

getAntigravityAccessToken({ forceRefresh: true })
  .then((auth) => {
    if (!auth?.accessToken) {
      console.error("AGY_AUTH_REQUIRED");
      process.exit(1);
      return;
    }
    const expiry = auth.expiresAt ? new Date(auth.expiresAt).toISOString() : "unknown";
    console.log(`ok ${expiry}`);
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.code || error.message);
    process.exit(1);
  });
