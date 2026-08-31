const fs = require("fs");
const os = require("os");
const path = require("path");

const TOKEN_REL = path.join(".gemini", "antigravity-cli", "antigravity-oauth-token");

function getTokenFilePath() {
  return path.join(os.homedir(), TOKEN_REL);
}
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_SKEW_SEC = 120;

// Embedded in every Antigravity CLI build — not user secrets (see antigravity_proxy).
const DEFAULT_CLIENT_ID =
  process.env.ANTIGRAVITY_CLIENT_ID ||
  "REDACTED_ANTIGRAVITY_CLIENT_ID";
const DEFAULT_CLIENT_SECRET =
  process.env.ANTIGRAVITY_CLIENT_SECRET || "REDACTED_ANTIGRAVITY_CLIENT_SECRET";

let cachedProjectId = null;
let cachedProjectBase = null;

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

async function refreshAccessToken(refreshToken, fetchImpl = fetch) {
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: DEFAULT_CLIENT_ID,
      client_secret: DEFAULT_CLIENT_SECRET,
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

async function getAntigravityAccessToken({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const data = readTokenFile();
  if (!data?.token) {
    throw authError(
      "Antigravity is not signed in. Run `agy auth login` in a terminal first.",
      "AGY_NOT_AUTHENTICATED"
    );
  }

  const tokenObj = { ...data.token };
  const expiryTs = parseExpiryTimestamp(tokenObj.expiry);
  const needsRefresh =
    forceRefresh ||
    !tokenObj.access_token ||
    expiryTs === 0 ||
    expiryTs - Date.now() / 1000 < TOKEN_REFRESH_SKEW_SEC;

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
  getAntigravityProjectId,
  getAntigravityProjectBase,
  clearAntigravityProjectCache,
  getAntigravityTokenPath,
  parseExpiryTimestamp,
  readTokenFile,
  refreshAccessToken,
};
