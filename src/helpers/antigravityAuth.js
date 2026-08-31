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

function resolveAgyBinaryPath() {
  const candidate = process.env.ANTIGRAVITY_CLI || "agy";
  if (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
    return fs.existsSync(candidate) ? candidate : null;
  }
  try {
    return execFileSync("which", [candidate], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

// ponytail: public Antigravity OAuth app creds live inside the agy binary; scrape at runtime so git never stores them.
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

  const authIdx = blob.indexOf("auth.cloud.google");
  if (authIdx < 0) {
    return null;
  }
  const window = blob.slice(Math.max(0, authIdx - 800), authIdx + 800);
  const clientId = window.match(/(\d+-[\w-]+\.apps\.googleusercontent\.com)/)?.[1];
  const clientSecret = window.match(/(GOCSPX-[A-Za-z0-9_-]+)/)?.[1];
  if (!clientId || !clientSecret) {
    return null;
  }
  return { clientId, clientSecret };
}

function resolveOAuthClientCredentials() {
  if (cachedOAuthClient) {
    return cachedOAuthClient;
  }

  const envId = process.env.ANTIGRAVITY_CLIENT_ID?.trim();
  const envSecret = process.env.ANTIGRAVITY_CLIENT_SECRET?.trim();
  if (envId && envSecret) {
    cachedOAuthClient = { clientId: envId, clientSecret: envSecret };
    return cachedOAuthClient;
  }

  const fromAgy = tryExtractOAuthFromAgyBinary();
  if (fromAgy) {
    cachedOAuthClient = fromAgy;
    return cachedOAuthClient;
  }

  throw authError(
    "Antigravity OAuth client credentials unavailable. Install `agy` on PATH or set ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET.",
    "AGY_OAUTH_CONFIG_MISSING"
  );
}

async function refreshAccessToken(refreshToken, fetchImpl = fetch) {
  const { clientId, clientSecret } = resolveOAuthClientCredentials();
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
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
  resolveOAuthClientCredentials,
  tryExtractOAuthFromAgyBinary,
};
