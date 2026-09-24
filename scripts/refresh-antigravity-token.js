#!/usr/bin/env node
"use strict";

// Refresh ~/.gemini/antigravity-cli/antigravity-oauth-token before it expires.
// MoreOpenWhisper reads that file on every dictation; the gateway path needs a
// valid access token. Pass --min-ttl-sec N to exit non-zero when expiry is
// farther out than N seconds (default 1500 = 25 minutes).
const {
  getAntigravityAccessToken,
  parseExpiryTimestamp,
  readTokenFile,
} = require("../src/helpers/antigravityAuth");

function parseMinTtlSec(argv) {
  const flag = argv.find((arg) => arg.startsWith("--min-ttl-sec="));
  if (flag) return Number(flag.split("=")[1]);
  const idx = argv.indexOf("--min-ttl-sec");
  if (idx >= 0 && argv[idx + 1]) return Number(argv[idx + 1]);
  return 25 * 60;
}

const minTtlSec = parseMinTtlSec(process.argv.slice(2));

getAntigravityAccessToken({ refreshSkewMs: minTtlSec * 1000 })
  .then((auth) => {
    if (!auth?.accessToken) {
      process.exit(1);
    }
    const expiryTs = parseExpiryTimestamp(readTokenFile()?.token?.expiry);
    const remainingSec = expiryTs ? expiryTs - Date.now() / 1000 : 0;
    if (remainingSec < minTtlSec) {
      process.exit(0);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error(error.code || error.message);
    process.exit(1);
  });
