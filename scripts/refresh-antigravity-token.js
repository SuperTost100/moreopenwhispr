#!/usr/bin/env node
"use strict";

// Refresh ~/.gemini/antigravity-cli/antigravity-oauth-token before it dies.
// Packed MoreOpenWhispr reads that file on every dictation and only uses the
// fast gateway while the access token is still valid.
const { getAntigravityAccessToken } = require("../src/helpers/antigravityAuth");

getAntigravityAccessToken({ minTtlSec: 25 * 60 })
  .then((token) => {
    process.exit(token ? 0 : 1);
  })
  .catch((error) => {
    console.error(error.code || error.message);
    process.exit(1);
  });
