// Antigravity credential path. `agy` is still the source of truth for the
// OAuth token file — this module reads it, and refreshes it two ways:
//
//   1. Directly against Google's token endpoint, using the OAuth client that
//      ships inside the `agy` binary. The client id/secret are extracted
//      in-process (fs streaming + regex scan, no `strings` subprocess — see
//      extractCredentialsFromFile) and cached in memory keyed by the
//      binary's realpath+mtime+size. A direct refresh takes well under a
//      second and does not rotate the refresh token. Only a sha256
//      fingerprint of the client id that last worked is ever persisted (see
//      persistLastKnownGoodClientId) — never the secret, never a token.
//   2. If extraction finds nothing, or every candidate client id/secret pair
//      is rejected, this falls back to the old `agy models` delegation: a
//      cheap, side-effect-free CLI call that makes agy refresh and rewrite
//      the token file on its own.
//
// Either way, this module is never the one minting a brand-new refresh
// token — only agy's own sign-in flow can do that, which is why an expired
// refresh token still ends in AGY_AUTH_REQUIRED ("run `agy auth login`
// again") rather than a silent failure.
const fs = require("fs");
const fsPromises = fs.promises;
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

// A direct refresh is ~0.5s, so the hot path can afford to wait until the
// last minute. The keepalive still tries 5 minutes ahead and, if that
// declines (a still-valid token agy won't touch), retries just before expiry.
const HOT_PATH_SKEW_MS = 60_000;
const KEEPALIVE_SKEW_MS = 5 * 60 * 1000;
const KEEPALIVE_LATE_SKEW_MS = 5_000;
const REFRESH_TIMEOUT_MS = 20_000; // `agy models` fallback refresh's own budget,
// independent of any individual caller's abort signal (see refreshViaAgy).
const DIRECT_REFRESH_TIMEOUT_MS = 10_000; // direct-refresh single-flight's own
// budget, independent of any individual caller's abort signal (see
// performDirectRefresh) — covers credential extraction (usually cached) plus
// every candidate pair attempt.

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

function readTokenFileUncached() {
  try {
    return JSON.parse(readTokenFileRaw());
  } catch {
    return null;
  }
}

// mtime-cached read: only re-stat+reparse when the file actually changed
// since the last read (agy is normally the only writer, and any direct
// refresh this module performs goes through invalidateTokenFileCache()).
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

function tokenObjEqual(a, b) {
  return Boolean(a && b && a.access_token === b.access_token && a.expiry === b.expiry);
}

// Atomic write: tmp file in the same dir + rename, mode 0600. Callers pass
// the full token-file shape (not just the token sub-object) so unrelated
// top-level fields (e.g. auth_method) survive untouched.
function writeTokenFileAtomic(data) {
  const tokenPath = getTokenFilePath();
  const dir = path.dirname(tokenPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.antigravity-oauth-token.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, tokenPath);
  try {
    fs.chmodSync(tokenPath, 0o600);
  } catch {
    // best-effort on platforms without POSIX permission bits (Windows)
  }
}

// Short, non-reversible fingerprint of the refresh token — safe to log or use
// as a cache/persistence key. Never derive this from the access token (it
// rotates far more often, which would thrash any per-account cache).
function accountKeyFor(refreshToken) {
  if (!refreshToken) return null;
  return crypto.createHash("sha256").update(refreshToken, "utf8").digest("hex").slice(0, 16);
}

function clientIdFingerprint(clientId) {
  return crypto.createHash("sha256").update(clientId, "utf8").digest("hex");
}

function resolveAgyBinaryPath() {
  try {
    return require("./antigravityCli").resolveAgyBinary();
  } catch {
    return null;
  }
}

// --- userData dir (injectable for tests, mirrors antigravityGateway.js's
// _setUserDataDirForTests so persisted state never touches a real Electron
// userData directory under plain node:test) -------------------------------

let userDataDirOverride = null;
function _setUserDataDirForTests(dir) {
  userDataDirOverride = dir;
}

function resolveUserDataDir() {
  if (userDataDirOverride) return userDataDirOverride;
  try {
    return require("electron").app.getPath("userData");
  } catch {
    return os.tmpdir();
  }
}

const CRED_STATE_FILENAME = "antigravity-oauth-client.json";

function credStateFilePath() {
  return path.join(resolveUserDataDir(), CRED_STATE_FILENAME);
}

function readCredState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(credStateFilePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Persists only a sha256 fingerprint of the client id that last worked, plus
// which binary it came from (realpath/mtime/size) — never the secret, never
// a token. Best-effort: a failed write just means the next refresh tries
// candidates in extraction order instead of last-known-good first.
function persistLastKnownGoodClientId(clientId) {
  if (!clientId) return;
  try {
    const filePath = credStateFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const payload = {
      version: 1,
      clientIdFingerprint: clientIdFingerprint(clientId),
      binaryPath: credentialsCache?.binaryPath || null,
      binaryMtimeMs: credentialsCache?.mtimeMs || null,
      binarySize: credentialsCache?.size || null,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload), { mode: 0o600 });
  } catch {
    // best-effort
  }
}

function orderCandidatesByLastKnownGood(candidates) {
  const state = readCredState();
  if (!state?.clientIdFingerprint) return candidates;
  const idx = candidates.findIndex(
    (candidate) => clientIdFingerprint(candidate.clientId) === state.clientIdFingerprint
  );
  if (idx <= 0) return candidates;
  const ordered = candidates.slice();
  const [preferred] = ordered.splice(idx, 1);
  ordered.unshift(preferred);
  return ordered;
}

// --- Credential extraction: read the agy binary in chunks (latin1, which is
// byte-preserving) with a small overlap between chunks so a match straddling
// a chunk boundary is never missed. No `strings` subprocess. -------------

const CLIENT_ID_RE = /\d+-[\w-]+\.apps\.googleusercontent\.com/g;
// GOCSPX- secrets have no delimiter after them, unlike the client id (which
// is naturally bounded by ".apps.googleusercontent.com"). The binary stores
// string constants back-to-back with no separator between them (observed on
// the real agy binary, consistent with Go's non-null-terminated string
// storage), so a greedy run past the real secret swallows the start of
// whatever constant happens to sit right after it in the binary and never
// authenticates. Google's current GOCSPX- secrets have a fixed 28-character
// body (35 chars total) — bound the primary match on that length so the
// common case never depends on there being a lucky delimiter, and also keep
// the untruncated greedy match as a second candidate in case a future secret
// format is longer or the delimiter assumption doesn't hold.
const CLIENT_SECRET_RE = /GOCSPX-[A-Za-z0-9_-]+/g;
const GOCSPX_PREFIX = "GOCSPX-";
const GOCSPX_BODY_LEN = 28;
const EXTRACT_CHUNK_BYTES = 4 * 1024 * 1024;
const EXTRACT_OVERLAP_BYTES = 256; // longer than any realistic id/secret match

async function extractCredentialsFromFile(filePath, { chunkBytes = EXTRACT_CHUNK_BYTES } = {}) {
  const clientIds = new Set();
  const secrets = new Set();
  const handle = await fsPromises.open(filePath, "r");
  try {
    const { size } = await handle.stat();
    let position = 0;
    let carry = "";
    while (position < size) {
      const length = Math.min(chunkBytes, size - position);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, position);
      const text = carry + buffer.toString("latin1");
      for (const match of text.matchAll(CLIENT_ID_RE)) clientIds.add(match[0]);
      for (const match of text.matchAll(CLIENT_SECRET_RE)) {
        secrets.add(match[0]);
        const boundedLength = GOCSPX_PREFIX.length + GOCSPX_BODY_LEN;
        if (match[0].length > boundedLength) {
          secrets.add(match[0].slice(0, boundedLength));
        }
      }
      carry = text.slice(-EXTRACT_OVERLAP_BYTES);
      position += length;
    }
  } finally {
    await handle.close();
  }
  // Candidate pairs = every (client id x secret) combination — the binary
  // carries two client ids and one secret at the time of writing, but this
  // doesn't assume that shape.
  const pairs = [];
  for (const clientId of clientIds) {
    for (const clientSecret of secrets) {
      pairs.push({ clientId, clientSecret });
    }
  }
  return pairs;
}

// In-memory cache of extracted candidate pairs, keyed by the resolved
// binary's realpath+mtime+size so a rotated/updated agy binary is picked up
// automatically. Extraction runs off the hot path (see
// startAntigravityTokenKeepalive) and lazily on first use otherwise.
let credentialsCache = null; // { key, binaryPath, mtimeMs, size, promise }

function getCandidateCredentials() {
  const agyPath = resolveAgyBinaryPath();
  if (!agyPath) return Promise.resolve([]);
  let realPath;
  try {
    realPath = fs.realpathSync(agyPath);
  } catch {
    realPath = agyPath;
  }
  let stat;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return Promise.resolve([]);
  }
  const key = `${realPath}:${stat.mtimeMs}:${stat.size}`;
  if (credentialsCache && credentialsCache.key === key) {
    return credentialsCache.promise;
  }
  const promise = extractCredentialsFromFile(realPath).catch(() => []);
  credentialsCache = { key, binaryPath: realPath, mtimeMs: stat.mtimeMs, size: stat.size, promise };
  return promise;
}

// --- Direct refresh against Google's token endpoint -----------------------

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

// Injectable for tests so no real network call is ever made under node:test.
let fetchOverride = null;
function _setFetchImplForTests(fn) {
  fetchOverride = fn;
}
function currentFetch() {
  return fetchOverride || fetch;
}

function buildRefreshedTokenObj(payload, fallbackRefreshToken) {
  const expiresIn = Number(payload.expires_in || 3600);
  const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  return {
    access_token: payload.access_token,
    // Never rotate the refresh token unless Google actually returned a new one.
    refresh_token: payload.refresh_token || fallbackRefreshToken,
    token_type: payload.token_type || "Bearer",
    expiry,
  };
}

async function tryRefreshWithPair({ clientId, clientSecret }, refreshToken, fetchFn, signal) {
  const response = await fetchFn(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (response.ok && payload.access_token) {
    return { outcome: "success", payload };
  }
  if (payload?.error === "invalid_grant") {
    return { outcome: "invalid_grant" };
  }
  // invalid_client / unauthorized_client / anything else ambiguous -> next pair
  return { outcome: "next" };
}

// Tries the last-known-good pair first, then the rest, stopping at the first
// 200. invalid_client/unauthorized_client moves on to the next pair;
// invalid_grant means the refresh token itself is dead, so it stops the
// whole attempt immediately (no pair can fix that) rather than burning the
// shared 10s budget on pairs that can't possibly work.
async function refreshAccessTokenDirect(refreshToken, candidates) {
  const ordered = orderCandidatesByLastKnownGood(candidates);
  const fetchFn = currentFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECT_REFRESH_TIMEOUT_MS);
  try {
    for (const pair of ordered) {
      let outcome;
      try {
        outcome = await tryRefreshWithPair(pair, refreshToken, fetchFn, controller.signal);
      } catch {
        if (controller.signal.aborted) {
          return { ok: false, reason: "timeout" };
        }
        continue; // network/parse error on this pair, try the next one
      }
      if (outcome.outcome === "success") {
        return {
          ok: true,
          clientId: pair.clientId,
          token: buildRefreshedTokenObj(outcome.payload, refreshToken),
        };
      }
      if (outcome.outcome === "invalid_grant") {
        return { ok: false, reason: "invalid_grant" };
      }
      // "next": fall through to the next candidate pair
    }
    return { ok: false, reason: "no_pair_worked" };
  } finally {
    clearTimeout(timer);
  }
}

// Single-flight: the first caller of a generation does the extraction (if
// not cached), the HTTP attempt(s), the re-read-before-write race check, and
// the write; every concurrent caller shares that one outcome instead of each
// re-reading/re-writing the token file themselves.
let inFlightDirectRefresh = null;

function directRefreshSingleFlight() {
  if (!inFlightDirectRefresh) {
    inFlightDirectRefresh = performDirectRefresh().finally(() => {
      inFlightDirectRefresh = null;
    });
  }
  return inFlightDirectRefresh;
}

async function performDirectRefresh() {
  const beforeData = readTokenFileUncached();
  const refreshToken = beforeData?.token?.refresh_token;
  if (!refreshToken) return { ok: false, reason: "no_refresh_token" };

  const candidates = await getCandidateCredentials();
  if (!candidates.length) return { ok: false, reason: "no_candidates" };

  const result = await refreshAccessTokenDirect(refreshToken, candidates);
  if (!result.ok) return result;

  persistLastKnownGoodClientId(result.clientId);

  // Re-read right before writing: if the file's access token/expiry changed
  // since beforeData was captured, someone else already refreshed it (e.g.
  // another process, or agy itself racing us) — keep theirs, don't clobber.
  const latest = readTokenFileUncached();
  if (latest?.token && !tokenObjEqual(latest.token, beforeData?.token)) {
    invalidateTokenFileCache();
    return { ok: true, tokenObj: latest.token, wrote: false };
  }

  const mergedData = {
    ...(latest || beforeData || {}),
    token: { ...(beforeData?.token || {}), ...result.token },
  };
  writeTokenFileAtomic(mergedData);
  invalidateTokenFileCache();
  return { ok: true, tokenObj: mergedData.token, wrote: true };
}

// Single-flight refresh: concurrent getAntigravityAccessToken() callers while
// a refresh is already in flight share the same promise instead of spawning
// their own `agy models` process. Deliberately NOT tied to any individual
// caller's abort signal — this promise's own timeout is the only thing that
// can end it, so caller A aborting doesn't kill the refresh caller B is also
// waiting on (or that the next caller would otherwise have to restart).
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
 * expired, within the skew window, or `forceRefresh` is set: tries a direct
 * refresh against Google's token endpoint first (single-flight, own 10s
 * timeout); if that doesn't produce a usable token (no candidates, every
 * pair rejected, refresh token dead, or timed out), falls back to a
 * single-flight `agy models` refresh and re-reads the file. If it's still
 * expired after both, rejects with AGY_AUTH_REQUIRED.
 */
async function getAntigravityAccessToken({
  signal,
  forceRefresh = false,
  refreshSkewMs = HOT_PATH_SKEW_MS,
} = {}) {
  let data = readTokenFile();
  if (!data?.token && !fs.existsSync(getTokenFilePath())) {
    throw createAntigravityError(
      "AGY_AUTH_REQUIRED",
      "Antigravity is not signed in. Run `agy auth login` in a terminal first."
    );
  }

  let tokenObj = data?.token;
  const needsRefresh = forceRefresh || tokenExpiresWithin(tokenObj, refreshSkewMs);

  if (needsRefresh) {
    let refreshedViaDirect = false;
    try {
      const directResult = await waitForRefresh(directRefreshSingleFlight(), signal);
      if (directResult?.ok) {
        refreshedViaDirect = true;
        invalidateTokenFileCache();
        data = readTokenFile();
        tokenObj = data?.token;
      }
    } catch (error) {
      // A caller-specific cancel must surface as a cancel, not silently fall
      // through to the agy fallback (which keeps running for other callers).
      if (error?.code === "AGY_CANCELLED") throw error;
      // Any other failure (shouldn't normally happen — performDirectRefresh
      // catches its own errors) falls through to the agy fallback below.
    }

    if (!refreshedViaDirect) {
      await waitForRefresh(refreshViaAgy(), signal);
      invalidateTokenFileCache();
      data = readTokenFile();
      tokenObj = data?.token;
    }

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
  const before = parseExpiryTimestamp(readTokenFile()?.token?.expiry);
  let failed = false;
  try {
    await getAntigravityAccessToken({ refreshSkewMs: KEEPALIVE_SKEW_MS });
  } catch {
    failed = true; // best-effort; an actual caller will surface the error
  }
  if (failed) {
    armKeepaliveTimer(KEEPALIVE_FAILURE_DELAY_MS);
    return;
  }
  const after = parseExpiryTimestamp(readTokenFile()?.token?.expiry);
  // agy declined to refresh a still-valid token: come back just before expiry.
  const declined = after && after === before && after * 1000 - Date.now() < KEEPALIVE_SKEW_MS;
  armKeepaliveTimer(KEEPALIVE_MIN_DELAY_MS, declined ? KEEPALIVE_LATE_SKEW_MS : KEEPALIVE_SKEW_MS);
}

function armKeepaliveTimer(minDelayMs = KEEPALIVE_MIN_DELAY_MS, skewMs = KEEPALIVE_SKEW_MS) {
  if (!keepaliveEnabled) return;
  if (keepaliveTimer) {
    clearTimeout(keepaliveTimer);
    keepaliveTimer = null;
  }
  const data = readTokenFile();
  const expiryTs = parseExpiryTimestamp(data?.token?.expiry);
  let delayMs = minDelayMs;
  if (expiryTs) {
    const untilRefresh = expiryTs * 1000 - Date.now() - skewMs;
    delayMs =
      skewMs === KEEPALIVE_SKEW_MS
        ? Math.max(minDelayMs, untilRefresh)
        : Math.max(1000, untilRefresh);
  }
  keepaliveTimer = setTimeout(keepaliveTick, delayMs);
  keepaliveTimer.unref?.();
}

function startAntigravityTokenKeepalive() {
  keepaliveEnabled = true;
  // Warm the credential-extraction cache off the hot path so the first real
  // refresh doesn't pay for reading the agy binary inline.
  getCandidateCredentials().catch(() => {});
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
  _extractCredentialsFromFile: extractCredentialsFromFile,
  _setUserDataDirForTests,
  _setFetchImplForTests,
};
