const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("node:module");

function freshAuthModule({ homedir, spawnCalls, spawnBehavior } = {}) {
  delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
  const originalHome = process.env.HOME;
  if (homedir) process.env.HOME = homedir;

  const originalHomedir = os.homedir;
  if (homedir) os.homedir = () => homedir;

  // execFile from child_process is what antigravityAuth uses to run
  // `agy models`; intercept it at the module-loader level (same pattern used
  // by test/helpers/accountScopeBinding.test.js for mocking "electron") so no
  // real subprocess is ever spawned by these tests.
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "child_process") {
      const real = originalLoad.call(this, request, parent, isMain);
      return {
        ...real,
        execFile: (command, args, options, callback) => {
          spawnCalls?.push({ command, args });
          const behavior = spawnBehavior || (() => Promise.resolve({ stdout: "", stderr: "" }));
          const cb = typeof options === "function" ? options : callback;
          Promise.resolve()
            .then(() => behavior({ command, args }))
            .then((result) => cb(null, result?.stdout || "", result?.stderr || ""))
            .catch((err) => cb(err));
          return { on: () => {} };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const mod = require("../../src/helpers/antigravityAuth");
  Module._load = originalLoad;

  return {
    mod,
    restore: () => {
      process.env.HOME = originalHome;
      os.homedir = originalHomedir;
      delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
    },
  };
}

function writeToken(homedir, token) {
  const tokenDir = path.join(homedir, ".gemini", "antigravity-cli");
  fs.mkdirSync(tokenDir, { recursive: true });
  fs.writeFileSync(
    path.join(tokenDir, "antigravity-oauth-token"),
    JSON.stringify({ token, auth_method: "consumer" })
  );
}

test("parseExpiryTimestamp parses the 3-digit-ms Z form", () => {
  const { mod, restore } = freshAuthModule();
  try {
    const ts = mod.parseExpiryTimestamp("2026-09-24T09:02:27.566Z");
    assert.ok(ts > 0);
    assert.equal(new Date(ts * 1000).toISOString(), "2026-09-24T09:02:27.566Z");
  } finally {
    restore();
  }
});

test("parseExpiryTimestamp parses the 6-digit-us explicit-offset form", () => {
  const { mod, restore } = freshAuthModule();
  try {
    const ts = mod.parseExpiryTimestamp("2026-09-24T11:03:16.105283+02:00");
    assert.ok(ts > 0);
    // 11:03:16.105 +02:00 == 09:03:16.105 UTC
    assert.equal(new Date(ts * 1000).toISOString(), "2026-09-24T09:03:16.105Z");
  } finally {
    restore();
  }
});

test("parseExpiryTimestamp returns 0 for garbage input", () => {
  const { mod, restore } = freshAuthModule();
  try {
    assert.equal(mod.parseExpiryTimestamp("not-a-date"), 0);
    assert.equal(mod.parseExpiryTimestamp(""), 0);
    assert.equal(mod.parseExpiryTimestamp(null), 0);
  } finally {
    restore();
  }
});

test("getAntigravityAccessToken returns a still-valid token with no refresh", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-valid-"));
  const spawnCalls = [];
  const { mod, restore } = freshAuthModule({ homedir, spawnCalls });
  try {
    writeToken(homedir, {
      access_token: "still-good",
      refresh_token: "refresh-me",
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(result.accessToken, "still-good");
    assert.equal(spawnCalls.length, 0);
    assert.equal(result.accountKey, mod.accountKeyFor("refresh-me"));
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("getAntigravityAccessToken refreshes an expired token via `agy models` and re-reads the rewritten file", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-expired-"));
  const spawnCalls = [];
  const { mod, restore } = freshAuthModule({
    homedir,
    spawnCalls,
    spawnBehavior: () => {
      // Simulate agy rewriting the token file as its side effect, exactly
      // like the real CLI does — this module never writes the file itself.
      writeToken(homedir, {
        access_token: "refreshed-by-agy",
        refresh_token: "refresh-me",
        expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      return Promise.resolve({ stdout: "model list...\n", stderr: "" });
    },
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(result.accessToken, "refreshed-by-agy");
    assert.equal(spawnCalls.length, 1);
    assert.deepEqual(spawnCalls[0].args, ["models"]);
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("getAntigravityAccessToken single-flights concurrent refreshes into exactly one `agy models` spawn", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-flight-"));
  const spawnCalls = [];
  let resolveSpawn;
  const spawnGate = new Promise((resolve) => {
    resolveSpawn = resolve;
  });
  const { mod, restore } = freshAuthModule({
    homedir,
    spawnCalls,
    spawnBehavior: async () => {
      await spawnGate;
      writeToken(homedir, {
        access_token: "refreshed-once",
        refresh_token: "refresh-me",
        expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      return { stdout: "ok\n", stderr: "" };
    },
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });

    const callerA = new AbortController();
    const pendingA = mod.getAntigravityAccessToken({ signal: callerA.signal });
    const pendingB = mod.getAntigravityAccessToken({});

    // Caller A cancels mid-refresh; the shared refresh must keep running for
    // caller B (and for the process as a whole) rather than dying with it.
    await new Promise((resolve) => setTimeout(resolve, 5));
    callerA.abort();
    resolveSpawn();

    await assert.rejects(pendingA, (error) => error.code === "AGY_CANCELLED");
    const resultB = await pendingB;
    assert.equal(resultB.accessToken, "refreshed-once");
    assert.equal(spawnCalls.length, 1, "only one agy models process for both concurrent callers");
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("getAntigravityAccessToken rejects with AGY_AUTH_REQUIRED when refresh doesn't fix an expired token", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-stuck-"));
  const spawnCalls = [];
  const { mod, restore } = freshAuthModule({
    homedir,
    spawnCalls,
    // agy runs but the token file is still expired afterward (e.g. the
    // refresh token itself was revoked).
    spawnBehavior: () => Promise.resolve({ stdout: "", stderr: "auth error\n" }),
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "revoked",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    await assert.rejects(
      () => mod.getAntigravityAccessToken({}),
      (error) => {
        assert.equal(error.code, "AGY_AUTH_REQUIRED");
        return true;
      }
    );
    assert.equal(spawnCalls.length, 1);
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("getAntigravityAccessToken rejects with AGY_AUTH_REQUIRED when no token file exists at all", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-none-"));
  const { mod, restore } = freshAuthModule({ homedir });
  try {
    await assert.rejects(
      () => mod.getAntigravityAccessToken({}),
      (error) => {
        assert.equal(error.code, "AGY_AUTH_REQUIRED");
        return true;
      }
    );
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("readTokenFile is mtime-cached: unchanged file is not re-parsed between calls", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-cache-"));
  const { mod, restore } = freshAuthModule({ homedir });
  try {
    writeToken(homedir, {
      access_token: "a",
      refresh_token: "r",
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const first = mod.readTokenFile();
    // Rewrite the file's *content* without changing mtime granularity isn't
    // reliable to simulate directly, so instead assert the cache returns the
    // same parsed object reference when the file hasn't changed at all.
    const second = mod.readTokenFile();
    assert.equal(first, second, "unchanged file should hit the mtime cache, not reparse");
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("accountKeyFor derives a short, non-reversible fingerprint of the refresh token", () => {
  const { mod, restore } = freshAuthModule();
  try {
    const key = mod.accountKeyFor("super-secret-refresh-token");
    assert.equal(typeof key, "string");
    assert.equal(key.length, 16);
    assert.doesNotMatch(key, /super-secret-refresh-token/);
    assert.equal(mod.accountKeyFor("super-secret-refresh-token"), key);
    assert.notEqual(mod.accountKeyFor("a-different-token"), key);
    assert.equal(mod.accountKeyFor(undefined), null);
  } finally {
    restore();
  }
});

test("a token with a few minutes left is used as-is, without spawning agy on the hot path", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-skew-"));
  const spawnCalls = [];
  const { mod, restore } = freshAuthModule({ homedir, spawnCalls });
  try {
    const expiry = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    writeToken(homedir, { access_token: "tok", refresh_token: "r", expiry });
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(result.accessToken, "tok");
    assert.equal(spawnCalls.length, 0);
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});
