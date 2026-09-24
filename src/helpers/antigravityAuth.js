// Antigravity credential path (A1). `agy` itself is the single writer of the
// OAuth token file — this module only reads it and, when the token is near
// expiry, shells out to `agy models` (a cheap, side-effect-free CLI call) to
// make agy refresh and rewrite the file on its own. No OAuth client id/secret
// ever lives in this app, and no request to oauth2.googleapis.com is made
// here: the old approach of scraping those credentials out of the agy binary
// and refreshing directly is gone (it produced "client secret is invalid"
// once agy rotated the pair server-side, which was the majority of dictation
// fallbacks to the slow --print path — see mow-work/gemini-plan-v2.md).
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { createAntigravityError } = require("./antigravityOperation");

const execFileAsync = promisify(execFile);

const TOKEN_REL = path.join(".gemini", "antigravity-cli", "antigravity-oauth-token");

function getTokenFilePath() {
  return path.join(os.homedir(), TOKEN_REL);
}

const REFRESH_SKEW_MS = 5 * 60 * 1000; // treat <5min-to-expiry as "needs refresh"
const REFRESH_TIMEOUT_MS = 20_000; // `agy models` refresh has its own budget,
// independent of any individual caller's abort signal (see refreshViaAgy).

// Cache of the last-read token file, keyed by mtime so a hot getAccessToken
// loop (every dictation) doesn't re-stat-and-reparse the file each call.
let cachedMtimeMs = null;
let cachedTokenData = null;

/**
 * Parses both expiry formats agy writes:
 *   "2026-09-24T09:02:27.566Z"                 (3-digit ms, Z)
 *   "2026-09-24T11:03:16.105283+02:00"          (6-digit us, explicit offset)
 * JS Date can't parse a 6-digit fractional-seconds component, so the
 * fraction is truncated to milliseconds before handing it to Date.parse.
 * Returns epoch seconds (matching the old helper's contract), or 0 if the
 * value can't be parsed at all.
 */
function parseExpiryTimestamp(expiryRaw) {
  if (!expiryRaw) return 0;
  if (typeof expiryRaw === "number") return expiryRaw;
  const raw = String(expiryRaw).trim();
  if (!raw) return 0;
  try {
    let normalized = raw;
    if (normalized.includes(".")) {
      const [head, tail] = normalized.split(".");
      let fraction = tail;
      let tz = "";
      for (let i = 0; i < tail.length; i += 1) {
        if ("Z+-".includes(tail[i])) {
          tz = tail.slice(i);
          fraction = tail.slice(0, i);
          break;
        }
      }
      normalized = `${head}.${fraction.slice(0, 3)}${tz}`;
    }
    const ms = Date.parse(normalized);
    if (Number.isNaN(ms)) return 0;
    return ms / 1000;
  } catch {
    return 0;
  }
}

function readTokenFileRaw() {
  return fs.readFileSync(getTokenFilePath(), "utf8");
}

// mtime-cached read: only re-stat+reparse when the file actually changed
// since the last read (agy is the only writer, so this is safe).
function readTokenFile() {
  const tokenPath = getTokenFilePath();
  let stat;
  try {
    stat = fs.statSync(tokenPath);
  } catch {
    cachedMtimeMs = null;
    cachedTokenData = null;
    return null;
  }
  if (cachedTokenData && cachedMtimeMs === stat.mtimeMs) {
    return cachedTokenData;
  }
  try {
    const parsed = JSON.parse(readTokenFileRaw());
    cachedMtimeMs = stat.mtimeMs;
    cachedTokenData = parsed;
    return parsed;
  } catch {
    cachedMtimeMs = null;
    cachedTokenData = null;
    return null;
  }
}

function invalidateTokenFileCache() {
  cachedMtimeMs = null;
  cachedTokenData = null;
}

// Short, non-reversible fingerprint of the refresh token — safe to log or use
// as a cache/persistence key. Never derive this from the access token (it
// rotates far more often, which would thrash any per-account cache).
function accountKeyFor(refreshToken) {
  if (!refreshToken) return null;
  return crypto.createHash("sha256").update(refreshToken, "utf8").digest("hex").slice(0, 16);
}

function resolveAgyBinaryPath() {
  try {
    return require("./antigravityCli").resolveAgyBinary();
  } catch {
    return null;
  }
}

// Single-flight refresh: concurrent getAntigravityAccessToken() callers while
// a refresh is already in flight share the same promise instead of spawning
// their own `agy models` process. Deliberately NOT tied to any individual
// caller's abort signal — this promise's own 20s timeout is the only thing
// that can end it, so caller A aborting doesn't kill the refresh caller B is
// also waiting on (or that the next caller would otherwise have to restart).
let inFlightRefresh = null;

async function spawnAgyModelsRefresh() {
  const agyPath = resolveAgyBinaryPath();
  const command = agyPath || "agy";
  try {
    await execFileAsync(command, ["models"], {
      timeout: REFRESH_TIMEOUT_MS,
      killSignal: "SIGTERM",
      windowsHide: true,
    });
  } catch (error) {
    // `agy models` prints a model list on success and a non-zero exit on
    // most failure modes; either way we only care whether it left the token
    // file in a refreshed state, checked by the caller after this resolves.
    // A killed-by-timeout child rejects with error.killed === true.
    if (error?.killed) {
      throw createAntigravityError(
        "AGY_TIMEOUT",
        `Antigravity refresh (agy models) timed out after ${REFRESH_TIMEOUT_MS}ms`
      );
    }
    // Swallow non-timeout failures here: re-reading the token file below is
    // the real source of truth for whether the refresh actually worked.
  }
}

function refreshViaAgy() {
  if (!inFlightRefresh) {
    inFlightRefresh = spawnAgyModelsRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

// A caller's abort only stops *that caller* waiting; the shared refresh keeps
// running for everyone else.
function waitForRefresh(refresh, signal) {
  const cancelled = () =>
    createAntigravityError("AGY_CANCELLED", "Antigravity auth request cancelled");
  if (!signal) return refresh;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(cancelled());
    signal.addEventListener("abort", onAbort, { once: true });
    refresh.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

function tokenExpiresWithin(tokenObj, skewMs) {
  if (!tokenObj?.access_token) return true;
  const expiryTs = parseExpiryTimestamp(tokenObj.expiry);
  if (expiryTs === 0) return true;
  return expiryTs * 1000 - Date.now() < skewMs;
}

/**
 * getAntigravityAccessToken({ signal, forceRefresh }) ->
 *   { accessToken, expiresAt, accountKey }
 *
 * Reads the agy-managed token file (mtime-cached). If the token is missing,
 * expired, within 5 minutes of expiry, or `forceRefresh` is set, triggers a
 * single-flight `agy models` refresh and re-reads the file. If it's still
 * expired after that, rejects with AGY_AUTH_REQUIRED.
 */
async function getAntigravityAccessToken({ signal, forceRefresh = false } = {}) {
  let data = readTokenFile();
  if (!data?.token && !fs.existsSync(getTokenFilePath())) {
    throw createAntigravityError(
      "AGY_AUTH_REQUIRED",
      "Antigravity is not signed in. Run `agy auth login` in a terminal first."
    );
  }

  let tokenObj = data?.token;
  const needsRefresh = forceRefresh || tokenExpiresWithin(tokenObj, REFRESH_SKEW_MS);

  if (needsRefresh) {
    await waitForRefresh(refreshViaAgy(), signal);
    invalidateTokenFileCache();
    data = readTokenFile();
    tokenObj = data?.token;

    if (!tokenObj?.access_token || tokenExpiresWithin(tokenObj, 0)) {
      throw createAntigravityError(
        "AGY_AUTH_REQUIRED",
        "Antigravity session could not be refreshed. Run `agy auth login` again."
      );
    }
  }

  const expiryTs = parseExpiryTimestamp(tokenObj.expiry);
  return {
    accessToken: tokenObj.access_token,
    expiresAt: expiryTs ? expiryTs * 1000 : null,
    accountKey: accountKeyFor(tokenObj.refresh_token),
  };
}

// --- Keepalive: proactively refresh ~5 minutes before expiry -------------

const KEEPALIVE_MIN_DELAY_MS = 60_000; // never re-arm tighter than 1 minute
// After a failed refresh (signed out, revoked token, agy missing) don't
// respawn `agy models` every minute; real callers still retry on demand.
const KEEPALIVE_FAILURE_DELAY_MS = 15 * 60 * 1000;
let keepaliveTimer = null;
let keepaliveEnabled = false;

async function keepaliveTick() {
  if (!keepaliveEnabled) return;
  let failed = false;
  try {
    await getAntigravityAccessToken({});
  } catch {
    failed = true; // best-effort; an actual caller will surface the error
  }
  armKeepaliveTimer(failed ? KEEPALIVE_FAILURE_DELAY_MS : KEEPALIVE_MIN_DELAY_MS);
}

function armKeepaliveTimer(minDelayMs = KEEPALIVE_MIN_DELAY_MS) {
  if (!keepaliveEnabled) return;
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
  const data = readTokenFile();
  const expiryTs = parseExpiryTimestamp(data?.token?.expiry);
  let delayMs = minDelayMs;
  if (expiryTs) {
    delayMs = Math.max(minDelayMs, expiryTs * 1000 - Date.now() - REFRESH_SKEW_MS);
  }
  keepaliveTimer = setTimeout(keepaliveTick, delayMs);
  keepaliveTimer.unref?.();
}

function startAntigravityTokenKeepalive() {
  keepaliveEnabled = true;
  armKeepaliveTimer();
}

function stopAntigravityTokenKeepalive() {
  keepaliveEnabled = false;
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
}

// A laptop waking from sleep may have missed its keepalive timer entirely
// (setTimeout doesn't fire while suspended); re-check/re-arm immediately.
// Wire this into Electron's powerMonitor 'resume' event.
function onSystemResume() {
  if (!keepaliveEnabled) return;
  keepaliveTick();
}

// --- Project id (kept for backward compatibility; antigravityGateway.js now
// owns the full memory -> persisted -> agy-hint -> loadCodeAssist chain, see
// getProjectId() there) ---------------------------------------------------

function getAntigravityTokenPath() {
  return getTokenFilePath();
}

module.exports = {
  getTokenFilePath,
  getAntigravityAccessToken,
  startAntigravityTokenKeepalive,
  stopAntigravityTokenKeepalive,
  onSystemResume,
  getAntigravityTokenPath,
  parseExpiryTimestamp,
  readTokenFile,
  accountKeyFor,
  invalidateTokenFileCache,
  // exported for tests only
  _refreshViaAgy: refreshViaAgy,
};
