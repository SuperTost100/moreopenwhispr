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
  process.env.HOME = tmpHome;
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
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
