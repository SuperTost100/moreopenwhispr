const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const TOKEN_REL = path.join(".gemini", "antigravity-cli", "antigravity-oauth-token");

function getTokenFilePath() {
  return path.join(os.homedir(), TOKEN_REL);
}
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_SKEW_SEC = 120;

let cachedOAuthClient = null;
let cachedOAuthCandidates = null;
let cachedProjectId = null;
let cachedProjectBase = null;

const CLIENT_ID_RE = /(\d+-[\w-]+\.apps\.googleusercontent\.com)/g;
// Split concatenated GOCSPX blobs (agy stores two secrets back-to-back).
const CLIENT_SECRET_RE =
  /GOCSPX-[A-Za-z0-9_-]{8,48}?(?=GOCSPX-|https?:\/\/|[^A-Za-z0-9_-]|$)/g;

function parseExpiryTimestamp(expiryRaw) {
  if (!expiryRaw) return 0;
  if (typeof expiryRaw === "number") return expiryRaw;
  const raw = String(expiryRaw).trim();
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
      normalized = `${head}.${fraction.slice(0, 6)}${tz}`;
    }
    return Date.parse(normalized) / 1000;
  } catch {
    return 0;
  }
}

function readTokenFile() {
  try {
    return JSON.parse(fs.readFileSync(getTokenFilePath(), "utf8"));
  } catch {
    return null;
  }
}

function writeTokenFile(data) {
  const tokenFile = getTokenFilePath();
  const tmp = `${tokenFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, tokenFile);
  try {
    fs.chmodSync(tokenFile, 0o600);
  } catch {
    // best-effort
  }
}

function authError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function resolveAgyBinaryPath() {
  try {
    return require("./antigravityCli").resolveAgyBinary();
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractOAuthCandidates(blob) {
  const haystack = String(blob || "");
  if (!haystack.includes("auth.cloud.google")) {
    return { clientIds: [], clientSecrets: [] };
  }
  return {
    clientIds: unique([...haystack.matchAll(CLIENT_ID_RE)].map((m) => m[1])),
    clientSecrets: unique([...haystack.matchAll(CLIENT_SECRET_RE)].map((m) => m[0])),
  };
}

function preferredOAuthPair(candidates) {
  if (!candidates?.clientIds?.length || !candidates?.clientSecrets?.length) {
    return null;
  }
  // Current agy: first GOCSPX sits on the authorize URL; the working
  // client id is the last .apps.googleusercontent.com in the binary.
  return {
    clientId: candidates.clientIds[candidates.clientIds.length - 1],
    clientSecret: candidates.clientSecrets[0],
  };
}

function oauthRefreshPairs(candidates) {
  const pairs = [];
  const seen = new Set();
  const add = (clientId, clientSecret) => {
    if (!clientId || !clientSecret) return;
    const key = `${clientId}\0${clientSecret}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ clientId, clientSecret });
  };
  const preferred = preferredOAuthPair(candidates);
  if (preferred) add(preferred.clientId, preferred.clientSecret);
  for (const clientId of candidates.clientIds) {
    for (const clientSecret of candidates.clientSecrets) {
      add(clientId, clientSecret);
    }
  }
  return pairs.slice(0, 6);
}

// ponytail: public Antigravity OAuth app creds live inside the agy binary; scrape at runtime so git never stores them.
function extractOAuthFromBlob(blob) {
  return preferredOAuthPair(extractOAuthCandidates(blob));
}

function tryExtractOAuthFromAgyBinary() {
  const agyPath = resolveAgyBinaryPath();
  if (!agyPath) {
    return null;
  }

  let blob = "";
  try {
    blob = execFileSync("strings", [agyPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    try {
      blob = fs.readFileSync(agyPath, "latin1");
    } catch {
      return null;
    }
  }

  const candidates = extractOAuthCandidates(blob);
  if (!candidates.clientIds.length || !candidates.clientSecrets.length) {
    return null;
  }
  cachedOAuthCandidates = candidates;
  return preferredOAuthPair(candidates);
}

function resolveOAuthCandidates() {
  if (cachedOAuthCandidates?.clientIds?.length && cachedOAuthCandidates?.clientSecrets?.length) {
    return cachedOAuthCandidates;
  }

  const envId = process.env.ANTIGRAVITY_CLIENT_ID?.trim();
  const envSecret = process.env.ANTIGRAVITY_CLIENT_SECRET?.trim();
  if (envId && envSecret) {
    cachedOAuthCandidates = { clientIds: [envId], clientSecrets: [envSecret] };
    return cachedOAuthCandidates;
  }

  const fromAgy = tryExtractOAuthFromAgyBinary();
  if (fromAgy && cachedOAuthCandidates) {
    return cachedOAuthCandidates;
  }

  throw authError(
    "Antigravity OAuth client credentials unavailable. Install `agy` on PATH or set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET.",
    "AGY_OAUTH_CONFIG_MISSING"
  );
}

function resolveOAuthClientCredentials() {
  if (cachedOAuthClient) {
    return cachedOAuthClient;
  }
  const pair = preferredOAuthPair(resolveOAuthCandidates());
  if (!pair) {
    throw authError(
      "Antigravity OAuth client credentials unavailable. Install `agy` on PATH or set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET.",
      "AGY_OAUTH_CONFIG_MISSING"
    );
  }
  cachedOAuthClient = pair;
  return cachedOAuthClient;
}

async function refreshWithPair(refreshToken, pair, fetchImpl) {
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: pair.clientId,
      client_secret: pair.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw authError(
      payload.error_description || payload.error || "Antigravity OAuth refresh failed",
      "AGY_TOKEN_EXPIRED"
    );
  }
  const expiresIn = Number(payload.expires_in || 3600);
  const expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || refreshToken,
    token_type: payload.token_type || "Bearer",
    expiry,
  };
}

async function refreshAccessToken(refreshToken, fetchImpl = fetch) {
  const candidates = resolveOAuthCandidates();
  const pairs = oauthRefreshPairs(candidates);
  if (cachedOAuthClient) {
    pairs.unshift(cachedOAuthClient);
  }
  const tried = new Set();
  let lastError = authError("Antigravity OAuth refresh failed", "AGY_TOKEN_EXPIRED");
  for (const pair of pairs) {
    const key = `${pair.clientId}\0${pair.clientSecret}`;
    if (tried.has(key)) continue;
    tried.add(key);
    try {
      const refreshed = await refreshWithPair(refreshToken, pair, fetchImpl);
      cachedOAuthClient = pair;
      return refreshed;
    } catch (error) {
      lastError = error;
    }
  }
  cachedOAuthClient = null;
  throw lastError;
}

async function getAntigravityAccessToken({
  fetchImpl = fetch,
  forceRefresh = false,
  minTtlSec = TOKEN_REFRESH_SKEW_SEC,
} = {}) {
  const data = readTokenFile();
  if (!data?.token) {
    throw authError(
      "Antigravity is not signed in. Run `agy auth login` in a terminal first.",
      "AGY_NOT_AUTHENTICATED"
    );
  }

  const tokenObj = { ...data.token };
  const expiryTs = parseExpiryTimestamp(tokenObj.expiry);
  const ttlFloor = Number.isFinite(minTtlSec) ? minTtlSec : TOKEN_REFRESH_SKEW_SEC;
  const needsRefresh =
    forceRefresh ||
    !tokenObj.access_token ||
    expiryTs === 0 ||
    expiryTs - Date.now() / 1000 < ttlFloor;

  if (needsRefresh) {
    if (!tokenObj.refresh_token) {
      throw authError(
        "Antigravity session expired. Run `agy auth login` again.",
        "AGY_NOT_AUTHENTICATED"
      );
    }
    const refreshed = await refreshAccessToken(tokenObj.refresh_token, fetchImpl);
    data.token = refreshed;
    writeTokenFile(data);
    return refreshed.access_token;
  }

  return tokenObj.access_token;
}

const TOKEN_KEEPALIVE_MS = 15 * 60 * 1000;
const TOKEN_KEEPALIVE_TTL_SEC = 25 * 60;
let tokenKeepaliveTimer = null;

function startAntigravityTokenKeepalive({
  intervalMs = TOKEN_KEEPALIVE_MS,
  minTtlSec = TOKEN_KEEPALIVE_TTL_SEC,
} = {}) {
  if (tokenKeepaliveTimer) return tokenKeepaliveTimer;
  const tick = () => {
    getAntigravityAccessToken({ minTtlSec }).catch(() => {});
  };
  tick();
  tokenKeepaliveTimer = setInterval(tick, intervalMs);
  tokenKeepaliveTimer.unref?.();
  return tokenKeepaliveTimer;
}

function stopAntigravityTokenKeepalive() {
  if (!tokenKeepaliveTimer) return;
  clearInterval(tokenKeepaliveTimer);
  tokenKeepaliveTimer = null;
}

function clearAntigravityProjectCache() {
  cachedProjectId = null;
  cachedProjectBase = null;
}

async function getAntigravityProjectId(deps = {}) {
  if (cachedProjectId) {
    return cachedProjectId;
  }
  const fetchImpl = deps.fetchImpl || fetch;
  const accessToken = await getAntigravityAccessToken({ fetchImpl });
  const { loadCodeAssist } = require("./antigravityGateway");
  const loaded = await loadCodeAssist({ accessToken, fetchImpl });
  cachedProjectId = loaded.projectId;
  cachedProjectBase = loaded.base;
  return cachedProjectId;
}

function getAntigravityProjectBase() {
  return cachedProjectBase;
}

function getAntigravityTokenPath() {
  return getTokenFilePath();
}

module.exports = {
  getTokenFilePath,
  getAntigravityAccessToken,
  startAntigravityTokenKeepalive,
  stopAntigravityTokenKeepalive,
  getAntigravityProjectId,
  getAntigravityProjectBase,
  clearAntigravityProjectCache,
  getAntigravityTokenPath,
  parseExpiryTimestamp,
  readTokenFile,
  refreshAccessToken,
  resolveOAuthClientCredentials,
  tryExtractOAuthFromAgyBinary,
  extractOAuthFromBlob,
  extractOAuthCandidates,
  oauthRefreshPairs,
};
