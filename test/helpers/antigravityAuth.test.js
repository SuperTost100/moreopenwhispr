const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("node:module");

function freshAuthModule({
  homedir,
  spawnCalls,
  spawnBehavior,
  agyBinaryPath,
  userDataDir,
  fetchImpl,
} = {}) {
  delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
  const originalHome = process.env.HOME;
  if (homedir) process.env.HOME = homedir;

  const originalHomedir = os.homedir;
  if (homedir) os.homedir = () => homedir;

  // ANTIGRAVITY_CLI is always pinned to an explicit path for these tests —
  // an absolute, guaranteed-missing path by default. Without this, credential
  // extraction (which reads the resolved agy binary directly off disk, not
  // through execFile) would find and read whatever real `agy` happens to be
  // installed on the machine running the tests, and could even attempt a
  // real HTTP refresh against Google. Tests that need extraction to succeed
  // pass agyBinaryPath pointing at a fake binary file they wrote themselves.
  const originalAntigravityCli = process.env.ANTIGRAVITY_CLI;
  process.env.ANTIGRAVITY_CLI =
    agyBinaryPath || path.join(homedir || os.tmpdir(), "no-such-agy-binary-xyz");

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

  mod._setUserDataDirForTests(
    userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-userdata-"))
  );
  if (fetchImpl) mod._setFetchImplForTests(fetchImpl);

  return {
    mod,
    restore: () => {
      process.env.HOME = originalHome;
      os.homedir = originalHomedir;
      process.env.ANTIGRAVITY_CLI = originalAntigravityCli;
      delete require.cache[require.resolve("../../src/helpers/antigravityAuth")];
    },
  };
}

// Writes a fake "agy" binary containing embedded fake OAuth client id(s) and
// secret(s), the same shape the real strings-scrape/extraction regexes look
// for, but obviously fake so nothing here is a real credential.
function writeFakeAgyBinary(
  dir,
  {
    clientIds = ["111111111111-fakeaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps." + "googleusercontent.com"],
    secret = "GOCSPX-" + "fakeSecretValueForTestsOnly1",
    padding = 0,
  } = {}
) {
  const binaryPath = path.join(dir, "fake-agy-binary");
  const parts = ["\x00\x00garbage-bytes-before\x00\x00"];
  for (const id of clientIds) {
    parts.push(`some noise "${id}" more noise `);
  }
  parts.push(`padding-filler-${"x".repeat(padding)}-`);
  parts.push(`token endpoint config "${secret}" trailing noise\x00\x00`);
  fs.writeFileSync(binaryPath, parts.join(""), "latin1");
  fs.chmodSync(binaryPath, 0o755);
  return binaryPath;
}

function fakeFetchResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
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

// --- Direct-refresh path: credential extraction + direct token endpoint ---

test("_extractCredentialsFromFile finds ids and secrets across chunk boundaries", async () => {
  const { mod, restore } = freshAuthModule();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-extract-"));
  try {
    const binaryPath = writeFakeAgyBinary(dir, {
      clientIds: [
        "111111111111-fakeaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps." + "googleusercontent.com",
        "222222222222-fakebbbbbbbbbbbbbbbbbbbbbbbbbbbb.apps." + "googleusercontent.com",
      ],
      secret: "GOCSPX-" + "fakeSecretValueForTestsOnly1",
      padding: 40,
    });
    // A tiny chunk size forces both the client ids and the secret to straddle
    // chunk boundaries at least once.
    const pairs = await mod._extractCredentialsFromFile(binaryPath, { chunkBytes: 17 });
    const ids = new Set(pairs.map((p) => p.clientId));
    const secrets = new Set(pairs.map((p) => p.clientSecret));
    assert.ok(
      ids.has("111111111111-fakeaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps." + "googleusercontent.com")
    );
    assert.ok(
      ids.has("222222222222-fakebbbbbbbbbbbbbbbbbbbbbbbbbbbb.apps." + "googleusercontent.com")
    );
    assert.ok(secrets.has("GOCSPX-" + "fakeSecretValueForTestsOnly1"));
    // every (id x secret) combination
    assert.equal(pairs.length, ids.size * secrets.size);
  } finally {
    restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("direct refresh tries the wrong pair, then the next pair, then succeeds", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-pairs-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-pairs-bin-"));
  const spawnCalls = [];
  const badId = "111111111111-badbadbadbadbadbadbadbadbadbadbadb.apps." + "googleusercontent.com";
  const goodId = "222222222222-goodgoodgoodgoodgoodgoodgoodgoodg.apps." + "googleusercontent.com";
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    fetchCalls.push(body.client_id);
    if (body.client_id === badId) {
      return fakeFetchResponse(401, { error: "invalid_client" });
    }
    return fakeFetchResponse(200, {
      access_token: "refreshed-direct",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    spawnCalls,
    agyBinaryPath: writeFakeAgyBinary(dir, { clientIds: [badId, goodId] }),
    fetchImpl,
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(result.accessToken, "refreshed-direct");
    assert.equal(
      spawnCalls.length,
      0,
      "agy models fallback must not run when direct refresh succeeds"
    );
    assert.ok(fetchCalls.includes(badId));
    assert.ok(fetchCalls.includes(goodId));
    assert.equal(fetchCalls[fetchCalls.length - 1], goodId);
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the last-known-good client id is tried first on the next refresh", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-lkg-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-lkg-bin-"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-lkg-ud-"));
  const badId = "111111111111-badbadbadbadbadbadbadbadbadbadbadb.apps." + "googleusercontent.com";
  const goodId = "222222222222-goodgoodgoodgoodgoodgoodgoodgoodg.apps." + "googleusercontent.com";
  const agyBinaryPath = writeFakeAgyBinary(dir, { clientIds: [badId, goodId] });
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    fetchCalls.push(body.client_id);
    if (body.client_id === badId) {
      return fakeFetchResponse(401, { error: "invalid_client" });
    }
    return fakeFetchResponse(200, {
      access_token: `refreshed-${fetchCalls.length}`,
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };

  // First refresh: extraction order is [bad, good] with no persisted
  // last-known-good yet, so it must try bad first, then good.
  {
    const { mod, restore } = freshAuthModule({ homedir, agyBinaryPath, userDataDir, fetchImpl });
    try {
      writeToken(homedir, {
        access_token: "expired",
        refresh_token: "refresh-me",
        expiry: "2000-01-01T00:00:00.000Z",
      });
      await mod.getAntigravityAccessToken({});
      assert.deepEqual(fetchCalls, [badId, goodId]);
    } finally {
      restore();
    }
  }

  // Second refresh (fresh module instance, same persisted userData dir):
  // the last-known-good client id (good) must be tried first this time.
  fetchCalls.length = 0;
  {
    const { mod, restore } = freshAuthModule({ homedir, agyBinaryPath, userDataDir, fetchImpl });
    try {
      writeToken(homedir, {
        access_token: "expired-again",
        refresh_token: "refresh-me",
        expiry: "2000-01-01T00:00:00.000Z",
      });
      await mod.getAntigravityAccessToken({});
      assert.equal(fetchCalls[0], goodId, "last-known-good pair must be tried first");
    } finally {
      restore();
    }
  }

  fs.rmSync(homedir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test("invalid_grant stops direct refresh immediately, falls back to agy, and ends in AGY_AUTH_REQUIRED", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-invalid-grant-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-invalid-grant-bin-"));
  const spawnCalls = [];
  const idA = "111111111111-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.apps." + "googleusercontent.com";
  const idB = "222222222222-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.apps." + "googleusercontent.com";
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push(JSON.parse(options.body).client_id);
    return fakeFetchResponse(400, { error: "invalid_grant" });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    spawnCalls,
    agyBinaryPath: writeFakeAgyBinary(dir, { clientIds: [idA, idB] }),
    fetchImpl,
    // agy also can't fix a dead refresh token — stdout/stderr as usual, but
    // the token file stays expired.
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
    assert.equal(fetchCalls.length, 1, "invalid_grant must stop trying further pairs");
    assert.equal(spawnCalls.length, 1, "agy fallback must still run after invalid_grant");
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent callers trigger exactly one direct-refresh HTTP request", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-flight-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-direct-flight-bin-"));
  let resolveFetch;
  const fetchGate = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const fetchCalls = [];
  const fetchImpl = async (url, options) => {
    fetchCalls.push(JSON.parse(options.body).client_id);
    await fetchGate;
    return fakeFetchResponse(200, {
      access_token: "refreshed-once",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    agyBinaryPath: writeFakeAgyBinary(dir),
    fetchImpl,
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    const pendingA = mod.getAntigravityAccessToken({});
    const pendingB = mod.getAntigravityAccessToken({});
    await new Promise((resolve) => setTimeout(resolve, 5));
    resolveFetch();
    const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
    assert.equal(resultA.accessToken, "refreshed-once");
    assert.equal(resultB.accessToken, "refreshed-once");
    assert.equal(fetchCalls.length, 1, "only one HTTP refresh for both concurrent callers");
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("no write happens when the token file changed underneath a direct refresh", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-race-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-race-bin-"));
  const fetchImpl = async () => {
    // Simulate another process rewriting the token file while our HTTP
    // request to Google is in flight.
    writeToken(homedir, {
      access_token: "written-by-someone-else",
      refresh_token: "refresh-me",
      expiry: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    return fakeFetchResponse(200, {
      access_token: "our-own-refreshed-token",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    agyBinaryPath: writeFakeAgyBinary(dir),
    fetchImpl,
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(
      result.accessToken,
      "written-by-someone-else",
      "must keep the concurrently-written token, not overwrite it with our own"
    );
    const onDisk = JSON.parse(
      fs.readFileSync(
        path.join(homedir, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
        "utf8"
      )
    );
    assert.equal(onDisk.token.access_token, "written-by-someone-else");
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a direct refresh never recreates the token file if it was deleted mid-refresh", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-delete-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-delete-bin-"));
  const tokenFile = path.join(homedir, ".gemini", "antigravity-cli", "antigravity-oauth-token");
  const fetchImpl = async () => {
    // Simulate the user (or another process) removing the credential file
    // while our HTTP request to Google is in flight.
    fs.rmSync(tokenFile, { force: true });
    return fakeFetchResponse(200, {
      access_token: "our-own-refreshed-token",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    agyBinaryPath: writeFakeAgyBinary(dir),
    fetchImpl,
    // agy fallback: pretend it also can't produce a token (file stays gone).
    spawnBehavior: () => Promise.resolve({ stdout: "", stderr: "" }),
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    await assert.rejects(
      () => mod.getAntigravityAccessToken({}),
      (error) => {
        assert.equal(error.code, "AGY_AUTH_REQUIRED");
        return true;
      }
    );
    assert.equal(
      fs.existsSync(tokenFile),
      false,
      "a direct refresh must not recreate a deleted token file"
    );
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a direct refresh refuses to persist when the refresh token changed underneath it", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-rt-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-rt-bin-"));
  const fetchImpl = async () => {
    // Simulate a concurrent full re-auth (new refresh token) landing while
    // our HTTP request to Google is in flight — same access_token/expiry
    // shape as before the race would have missed this.
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "brand-new-refresh-token",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    return fakeFetchResponse(200, {
      access_token: "our-own-refreshed-token",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  };
  const { mod, restore } = freshAuthModule({
    homedir,
    agyBinaryPath: writeFakeAgyBinary(dir),
    fetchImpl,
  });
  try {
    writeToken(homedir, {
      access_token: "expired",
      refresh_token: "refresh-me",
      expiry: "2000-01-01T00:00:00.000Z",
    });
    await mod.getAntigravityAccessToken({}).catch(() => {});
    const onDisk = JSON.parse(
      fs.readFileSync(
        path.join(homedir, ".gemini", "antigravity-cli", "antigravity-oauth-token"),
        "utf8"
      )
    );
    assert.equal(
      onDisk.token.refresh_token,
      "brand-new-refresh-token",
      "must not overwrite a concurrently-rotated refresh token with a stale-scoped refresh result"
    );
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a successful direct refresh writes an atomic, 0600 file that preserves unrelated fields", async () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-shape-"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-auth-shape-bin-"));
  const fetchImpl = async () =>
    fakeFetchResponse(200, {
      access_token: "refreshed-shape",
      refresh_token: "refresh-me",
      expires_in: 3600,
    });
  const { mod, restore } = freshAuthModule({
    homedir,
    agyBinaryPath: writeFakeAgyBinary(dir),
    fetchImpl,
  });
  try {
    const tokenDir = path.join(homedir, ".gemini", "antigravity-cli");
    fs.mkdirSync(tokenDir, { recursive: true });
    const tokenFile = path.join(tokenDir, "antigravity-oauth-token");
    fs.writeFileSync(
      tokenFile,
      JSON.stringify({
        auth_method: "consumer",
        some_other_top_level_field: "keep-me",
        token: {
          access_token: "expired",
          refresh_token: "refresh-me",
          expiry: "2000-01-01T00:00:00.000Z",
          scope: "keep-this-scope",
        },
      })
    );
    const result = await mod.getAntigravityAccessToken({});
    assert.equal(result.accessToken, "refreshed-shape");

    const onDisk = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
    assert.equal(onDisk.auth_method, "consumer");
    assert.equal(onDisk.some_other_top_level_field, "keep-me");
    assert.equal(onDisk.token.scope, "keep-this-scope");
    assert.equal(onDisk.token.access_token, "refreshed-shape");
    assert.equal(onDisk.token.refresh_token, "refresh-me");
    assert.match(onDisk.token.expiry, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    if (process.platform !== "win32") {
      const mode = fs.statSync(tokenFile).mode & 0o777;
      assert.equal(mode, 0o600);
    }
  } finally {
    restore();
    fs.rmSync(homedir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
