const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseExpiryTimestamp,
  getAntigravityAccessToken,
} = require("../../src/helpers/antigravityAuth");

test("parseExpiryTimestamp parses RFC3339 with timezone offset", () => {
  const ts = parseExpiryTimestamp("2026-08-23T13:55:03.196847+02:00");
  assert.ok(ts > 0);
});

test("getAntigravityAccessToken refreshes expired token", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-"));
  const tokenDir = path.join(tmpHome, ".gemini", "antigravity-cli");
  fs.mkdirSync(tokenDir, { recursive: true });
  const tokenFile = path.join(tokenDir, "antigravity-oauth-token");
  fs.writeFileSync(
    tokenFile,
    JSON.stringify({
      token: {
        access_token: "old",
        refresh_token: "refresh-me",
        expiry: "2000-01-01T00:00:00.000Z",
      },
    })
  );

  const originalHome = process.env.HOME;
  const originalClientId = process.env.ANTIGRAVITY_CLIENT_ID;
  const originalClientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;
  process.env.HOME = tmpHome;
  process.env.ANTIGRAVITY_CLIENT_ID = "test-client-id";
  process.env.ANTIGRAVITY_CLIENT_SECRET = "test-client-secret";
  delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
  const { getAntigravityAccessToken: getToken } = require("../../src/helpers/antigravityAuth");

  try {
    const fetchImpl = async (url, init) => {
      assert.match(url, /oauth2.googleapis.com/);
      const body = JSON.parse(init.body);
      assert.equal(body.refresh_token, "refresh-me");
      return {
        ok: true,
        json: async () => ({
          access_token: "fresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      };
    };

    const token = await getToken({ fetchImpl });
    assert.equal(token, "fresh-token");
    const saved = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    assert.equal(saved.token.access_token, "fresh-token");
  } finally {
    process.env.HOME = originalHome;
    if (originalClientId === undefined) {
      delete process.env.ANTIGRAVITY_CLIENT_ID;
    } else {
      process.env.ANTIGRAVITY_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.ANTIGRAVITY_CLIENT_SECRET;
    } else {
      process.env.ANTIGRAVITY_CLIENT_SECRET = originalClientSecret;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("getAntigravityAccessToken refreshes when remaining TTL is below minTtlSec", async () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-ttl-"));
  const tokenDir = path.join(tmpHome, ".gemini", "antigravity-cli");
  fs.mkdirSync(tokenDir, { recursive: true });
  const tokenFile = path.join(tokenDir, "antigravity-oauth-token");
  const soon = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  fs.writeFileSync(
    tokenFile,
    JSON.stringify({
      token: {
        access_token: "still-valid",
        refresh_token: "refresh-me",
        expiry: soon,
      },
    })
  );

  const originalHome = process.env.HOME;
  const originalClientId = process.env.ANTIGRAVITY_CLIENT_ID;
  const originalClientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;
  process.env.HOME = tmpHome;
  process.env.ANTIGRAVITY_CLIENT_ID = "test-client-id";
  process.env.ANTIGRAVITY_CLIENT_SECRET = "test-client-secret";
  delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
  const { getAntigravityAccessToken: getToken } = require("../../src/helpers/antigravityAuth");

  try {
    let fetches = 0;
    const fetchImpl = async () => {
      fetches += 1;
      return {
        ok: true,
        json: async () => ({
          access_token: "kept-fresh",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      };
    };

    const skipped = await getToken({ fetchImpl, minTtlSec: 120 });
    assert.equal(skipped, "still-valid");
    assert.equal(fetches, 0);

    const refreshed = await getToken({ fetchImpl, minTtlSec: 25 * 60 });
    assert.equal(refreshed, "kept-fresh");
    assert.equal(fetches, 1);
  } finally {
    process.env.HOME = originalHome;
    if (originalClientId === undefined) {
      delete process.env.ANTIGRAVITY_CLIENT_ID;
    } else {
      process.env.ANTIGRAVITY_CLIENT_ID = originalClientId;
    }
    if (originalClientSecret === undefined) {
      delete process.env.ANTIGRAVITY_CLIENT_SECRET;
    } else {
      process.env.ANTIGRAVITY_CLIENT_SECRET = originalClientSecret;
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("extractOAuthFromBlob finds client id far after the authorize URL", () => {
  const { extractOAuthFromBlob } = require("../../src/helpers/antigravityAuth");
  const padding = "x".repeat(50_000);
  const blob = [
    "https://auth.cloud.google/authorize",
    "\0",
    "GOCSPX-unitTestSecretValue",
    "\0",
    padding,
    "\0",
    "123456789012-unit-test.apps.googleusercontent.com",
  ].join("");
  assert.deepEqual(extractOAuthFromBlob(blob), {
    clientId: "123456789012-unit-test.apps.googleusercontent.com",
    clientSecret: "GOCSPX-unitTestSecretValue",
  });
  assert.equal(extractOAuthFromBlob("no oauth here"), null);
});

test("extractOAuthFromBlob splits concatenated secrets and prefers the last client id", () => {
  const { extractOAuthFromBlob, extractOAuthCandidates, oauthRefreshPairs } = require("../../src/helpers/antigravityAuth");
  const blob = [
    "https://auth.cloud.google/authorize",
    "GOCSPX-aaaaaaaaaaaaaaaaaaaa",
    "GOCSPX-bbbbbbbbbbbbbbbbbbbb",
    "https://cloudcode-pa.googleapis.com",
    "111111111111-first.apps.googleusercontent.com",
    "222222222222-second.apps.googleusercontent.com",
  ].join("");
  const candidates = extractOAuthCandidates(blob);
  assert.deepEqual(candidates, {
    clientIds: [
      "111111111111-first.apps.googleusercontent.com",
      "222222222222-second.apps.googleusercontent.com",
    ],
    clientSecrets: ["GOCSPX-aaaaaaaaaaaaaaaaaaaa", "GOCSPX-bbbbbbbbbbbbbbbbbbbb"],
  });
  assert.deepEqual(extractOAuthFromBlob(blob), {
    clientId: "222222222222-second.apps.googleusercontent.com",
    clientSecret: "GOCSPX-aaaaaaaaaaaaaaaaaaaa",
  });
  const pairs = oauthRefreshPairs(candidates);
  assert.equal(pairs[0].clientId, "222222222222-second.apps.googleusercontent.com");
  assert.equal(pairs[0].clientSecret, "GOCSPX-aaaaaaaaaaaaaaaaaaaa");
  assert.equal(pairs.length, 4);
});
