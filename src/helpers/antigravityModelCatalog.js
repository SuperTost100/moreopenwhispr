// Antigravity model catalog (A4). The daily gateway's fetchAvailableModels
// tells us which models exist, which accept audio, their quota, and which
// ids the server currently puts in each tier (flash / flashLite / pro). This
// module keeps the last good copy (memory -> persisted userData -> a small
// static fallback) and resolves "which model do we call for STT / cleanup /
// chat" from it with a pure function, so a server-side model rotation no
// longer needs an app release.
const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");
const { createAntigravityOperation, createAntigravityError } = require("./antigravityOperation");
const { isAntigravityTranscribeModel } = require("./antigravityTranscriptionPolicy");

// Measured 1.4-1.9 s warm for a 7 s clip and accepts audio; the last resort
// for every slot when the catalog offers nothing usable.
const PINNED_FALLBACK_MODEL = "gemini-2.5-flash-lite";

const CATALOG_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CATALOG_STARTUP_DELAY_MS = 15_000;
const MODEL_UNAVAILABLE_DEBOUNCE_MS = 60_000;
const CATALOG_BUDGET_MS = 15_000;
const MAX_DEPRECATION_HOPS = 5;
const CATALOG_CACHE_FILENAME = "antigravity-model-catalog.json";

const AUDIO_MIME_TYPES = {
  "audio/wav": true,
  "audio/mp3": true,
  "audio/aac": true,
  "audio/ogg": true,
  "audio/flac": true,
  "audio/webm": true,
};

// Today's server answer (2026-09), trimmed to what the resolver needs. Only
// used until the first successful fetch; never persisted.
const STATIC_FALLBACK_CATALOG = Object.freeze({
  source: "static",
  fetchedAt: null,
  models: {
    "gemini-3.8-flash-tiered": {
      displayName: "Gemini 3.8 Flash",
      supportsImages: true,
      supportsThinking: true,
      supportedMimeTypes: AUDIO_MIME_TYPES,
      quotaInfo: {},
      recommended: true,
      tagTitle: null,
    },
    "gemini-3.5-flash-lite": {
      displayName: "Gemini 3.5 Flash Lite",
      supportsImages: true,
      supportsThinking: true,
      supportedMimeTypes: AUDIO_MIME_TYPES,
      quotaInfo: {},
      recommended: false,
      tagTitle: null,
    },
    [PINNED_FALLBACK_MODEL]: {
      displayName: "Gemini 2.5 Flash Lite",
      supportsImages: true,
      supportsThinking: true,
      supportedMimeTypes: AUDIO_MIME_TYPES,
      quotaInfo: {},
      recommended: false,
      tagTitle: null,
    },
  },
  tieredModelIds: {
    flash: ["gemini-3.8-flash-tiered"],
    flashLite: ["gemini-3.5-flash-lite"],
    pro: [],
  },
  deprecatedModelIds: {},
  defaultAgentModelId: null,
  commandModelIds: [],
});

// --- Schema validation -----------------------------------------------------

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stringList = (value) =>
  Array.isArray(value) ? value.filter((id) => typeof id === "string" && id.trim()) : [];

function normalizeModelEntry(id, entry) {
  const mimeTypes = {};
  if (isPlainObject(entry.supportedMimeTypes)) {
    for (const [mime, enabled] of Object.entries(entry.supportedMimeTypes)) {
      if (enabled === true) mimeTypes[mime] = true;
    }
  }
  const quota = isPlainObject(entry.quotaInfo) ? entry.quotaInfo : {};
  return {
    displayName:
      typeof entry.displayName === "string" && entry.displayName ? entry.displayName : id,
    supportsImages: entry.supportsImages === true,
    supportsThinking: entry.supportsThinking === true,
    supportedMimeTypes: mimeTypes,
    quotaInfo: {
      remainingFraction: Number.isFinite(quota.remainingFraction)
        ? quota.remainingFraction
        : undefined,
      resetTime: typeof quota.resetTime === "string" ? quota.resetTime : undefined,
    },
    recommended: entry.recommended === true,
    tagTitle: typeof entry.tagTitle === "string" && entry.tagTitle ? entry.tagTitle : null,
  };
}

/**
 * Returns a normalized catalog, or null when the payload isn't shaped like a
 * fetchAvailableModels response (the caller then keeps the last good copy).
 * Individual malformed model entries are dropped rather than failing the
 * whole catalog.
 */
function validateCatalog(raw) {
  if (!isPlainObject(raw) || !isPlainObject(raw.models)) return null;
  const models = {};
  for (const [id, entry] of Object.entries(raw.models)) {
    if (typeof id === "string" && id.trim() && isPlainObject(entry)) {
      models[id] = normalizeModelEntry(id, entry);
    }
  }
  if (Object.keys(models).length === 0) return null;

  const tiers = isPlainObject(raw.tieredModelIds) ? raw.tieredModelIds : {};
  const deprecatedModelIds = {};
  if (isPlainObject(raw.deprecatedModelIds)) {
    for (const [oldId, info] of Object.entries(raw.deprecatedModelIds)) {
      if (typeof info?.newModelId === "string" && info.newModelId) {
        deprecatedModelIds[oldId] = { newModelId: info.newModelId };
      }
    }
  }
  return {
    models,
    tieredModelIds: {
      flash: stringList(tiers.flash),
      flashLite: stringList(tiers.flashLite),
      pro: stringList(tiers.pro),
    },
    deprecatedModelIds,
    defaultAgentModelId:
      typeof raw.defaultAgentModelId === "string" ? raw.defaultAgentModelId : null,
    commandModelIds: stringList(raw.commandModelIds),
  };
}

// --- Cooldowns -------------------------------------------------------------

// ponytail: in-process only; resets on restart. Wave 2 failover feeds this
// from AGY_RATE_LIMITED (model scope) using retryAfterMs.
const modelCooldowns = new Map();

function markModelCooldown(model, untilMs) {
  if (!model || !Number.isFinite(untilMs)) return;
  modelCooldowns.set(model, untilMs);
}

function clearModelCooldowns() {
  modelCooldowns.clear();
}

// The catalog's quota data and the cooldowns describe one agy account.
// After `agy auth login` with another account they'd hide models the new
// account can use, so both are dropped when the signed-in account changes.
function defaultAccountKeyResolver() {
  const auth = require("./antigravityAuth");
  return auth.accountKeyFor(auth.readTokenFile()?.token?.refresh_token) || null;
}

let accountKeyResolver = defaultAccountKeyResolver;
let onAccountChanged = () => refreshQuietly("account-changed");
let lastSeenAccountKey = null;

function currentAccountKey() {
  try {
    return accountKeyResolver() || null;
  } catch {
    return null;
  }
}

function _setAccountKeyResolverForTests(resolver, accountChanged) {
  accountKeyResolver = resolver || defaultAccountKeyResolver;
  onAccountChanged = accountChanged || (() => refreshQuietly("account-changed"));
  lastSeenAccountKey = null;
}

// --- Pure resolver -----------------------------------------------------------

function supportsAudio(entry) {
  return Object.keys(entry?.supportedMimeTypes || {}).some((mime) => mime.startsWith("audio/"));
}

function isQuotaExhausted(entry, now) {
  const { remainingFraction, resetTime } = entry?.quotaInfo || {};
  if (remainingFraction !== 0) return false;
  const resetMs = Date.parse(resetTime || "");
  // No parseable reset time: trust the 0 and treat it as exhausted.
  return Number.isNaN(resetMs) || resetMs > now;
}

function mapDeprecated(catalog, id) {
  const deprecated = catalog?.deprecatedModelIds || {};
  let current = id;
  const seen = new Set([id]);
  for (let hop = 0; hop < MAX_DEPRECATION_HOPS; hop += 1) {
    const next = deprecated[current]?.newModelId;
    if (!next) return { id: current, mapped: current !== id, cycle: false };
    if (seen.has(next)) return { id, mapped: false, cycle: true };
    seen.add(next);
    current = next;
  }
  return deprecated[current]?.newModelId
    ? { id, mapped: false, cycle: true }
    : { id: current, mapped: current !== id, cycle: false };
}

const SLOT_TIERS = {
  stt: ["flash", "flashLite"],
  cleanup: ["flashLite", "flash"],
  chat: ["flash"],
};

// Earliest known-future reset time across a slot's tiers (model quota
// resetTime) and any active cooldowns, including the pinned fallback. Used
// when a slot ends up with zero usable candidates, so the caller can surface
// a concrete retry time instead of a generic failure.
function soonestResetMsForSlot(catalog, slot, cooldowns, now) {
  const models = catalog?.models || {};
  let soonest = null;
  const consider = (ms) => {
    if (Number.isFinite(ms) && ms > now && (soonest === null || ms < soonest)) soonest = ms;
  };
  const considerModel = (id) => {
    consider(Date.parse(models[id]?.quotaInfo?.resetTime || ""));
    consider(cooldowns?.get?.(id));
  };
  for (const tier of SLOT_TIERS[slot] || []) {
    for (const id of catalog?.tieredModelIds?.[tier] || []) considerModel(id);
  }
  considerModel(PINNED_FALLBACK_MODEL);
  return soonest;
}

/**
 * resolveAntigravityModels(catalog, prefs, now, cooldowns?) ->
 *   { stt, cleanup, chat, candidates: { stt, cleanup, chat }, notices,
 *     emptyResetMs: { [slot]: number } }
 *
 * Each slot is the first entry of its ordered candidate list. An explicit
 * pick (after deprecation mapping) leads when it's in the catalog, capable
 * (STT needs an audio MIME type) and usable; otherwise the "auto" policy
 * leads and a notice explains why. Synthetic transcription-mode ids
 * (gemini-3.5-transcribe*) are modes, never explicit model picks.
 *
 * Quota/cooldown eligibility (`usable`) applies to every candidate,
 * including the pinned fallback and an explicit pick: a model known (from
 * current catalog data) to be quota-exhausted or cooling is never retried
 * just because nothing else was offered. The one exception is a pick or
 * pinned model *missing* from a possibly-stale catalog — its state is
 * unknown, not known-bad, so it stays as a last resort. If every candidate
 * for a slot is eliminated this way, `candidates[slot]` is empty and
 * `emptyResetMs[slot]` carries the soonest known reset/cooldown time (if
 * any) for callers to surface as AGY_RATE_LIMITED.
 */
function resolveAntigravityModels(
  catalog,
  prefs = {},
  now = Date.now(),
  cooldowns = modelCooldowns
) {
  const models = catalog?.models || {};
  const notices = [];
  const result = { candidates: {}, notices, emptyResetMs: {} };

  // A model rate-limited this session is skipped even when the catalog
  // doesn't list it (the pinned fallback, an explicit pick).
  const cooling = (id) => {
    const coolingUntil = cooldowns?.get?.(id);
    return Number.isFinite(coolingUntil) && coolingUntil > now;
  };
  const usable = (id) => {
    const entry = models[id];
    if (!entry) return false;
    if (isQuotaExhausted(entry, now)) return false;
    return !cooling(id);
  };

  for (const [slot, tiers] of Object.entries(SLOT_TIERS)) {
    const capable = (id) => (slot === "stt" ? supportsAudio(models[id]) : true);
    const list = [];
    const push = (id) => {
      if (id && !list.includes(id)) list.push(id);
    };

    // Only set when the explicit pick is absent from a possibly-stale
    // catalog — the one case where it stays a last resort despite failing
    // `usable`/`capable` checks below (its real availability is unknown,
    // not known-bad).
    let lastResortIfMissing = null;
    const raw = typeof prefs?.[slot] === "string" ? prefs[slot].trim() : "";
    if (raw && raw !== "auto" && !isAntigravityTranscribeModel(raw)) {
      const mapped = mapDeprecated(catalog, raw);
      if (mapped.cycle) {
        notices.push({ slot, code: "DEPRECATION_CYCLE", model: raw });
      } else if (mapped.mapped) {
        notices.push({ slot, code: "DEPRECATED_MAPPED", model: raw, replacement: mapped.id });
      }
      const pick = mapped.id;
      if (!models[pick]) {
        notices.push({ slot, code: "EXPLICIT_NOT_IN_CATALOG", model: pick });
        lastResortIfMissing = pick;
      } else if (!capable(pick)) {
        notices.push({ slot, code: "EXPLICIT_NOT_CAPABLE", model: pick });
      } else if (!usable(pick)) {
        // Known quota-exhausted or cooling — do not reintroduce it as a
        // last resort; retrying it wastes a request certain to fail again.
        notices.push({ slot, code: "EXPLICIT_UNAVAILABLE", model: pick });
      } else {
        push(pick);
      }
    }

    for (const tier of tiers) {
      for (const id of catalog?.tieredModelIds?.[tier] || []) {
        const resolved = mapDeprecated(catalog, id).id;
        if (capable(resolved) && usable(resolved)) push(resolved);
      }
    }
    // The pinned model is a known-good last resort, but only when it isn't
    // itself known-bad: skip it if current catalog data says it's
    // quota-exhausted or cooling. If it's simply absent from a
    // possibly-stale catalog, its state is unknown, so keep it as an
    // unconditional fallback.
    if (
      models[PINNED_FALLBACK_MODEL]
        ? usable(PINNED_FALLBACK_MODEL)
        : !cooling(PINNED_FALLBACK_MODEL)
    ) {
      push(PINNED_FALLBACK_MODEL);
    }
    if (!cooling(lastResortIfMissing)) push(lastResortIfMissing);

    result.candidates[slot] = list;
    result[slot] = list[0];
    if (list.length === 0) {
      const resetMs = soonestResetMsForSlot(catalog, slot, cooldowns, now);
      if (resetMs !== null) result.emptyResetMs[slot] = resetMs;
    }
  }
  return result;
}

/**
 * emptyCandidatesError(resolved, slot, now?) -> typed AGY_RATE_LIMITED error
 *
 * Callers of resolveAntigravityModels use this when `candidates[slot]` came
 * back empty (every candidate, including the pinned fallback, is known
 * quota-exhausted or cooling): an account-scoped rate limit with the
 * soonest known reset time, rather than a generic failure that would just
 * get retried against models already known to fail.
 */
function emptyCandidatesError(resolved, slot, now = Date.now()) {
  const resetMs = resolved?.emptyResetMs?.[slot];
  const hasResetMs = Number.isFinite(resetMs);
  return createAntigravityError(
    "AGY_RATE_LIMITED",
    "Antigravity has no available models for this request right now (quota-exhausted or cooling down)",
    {
      scope: "account",
      ...(hasResetMs ? { retryAfterMs: Math.max(0, resetMs - now), resetAt: resetMs } : {}),
    }
  );
}

function listSelectableModels(catalog) {
  const models = catalog?.models || {};
  const deprecated = catalog?.deprecatedModelIds || {};
  return Object.entries(models)
    .filter(([id]) => !deprecated[id])
    .map(([id, entry]) => ({
      id,
      displayName: entry.displayName || id,
      tag: entry.tagTitle || null,
      supportsAudio: supportsAudio(entry),
      supportsImages: entry.supportsImages === true,
    }));
}

// --- Cache + refresh -------------------------------------------------------

let memoryCatalog = null;
let inFlightRefresh = null;

function catalogCacheFilePath() {
  return path.join(require("./antigravityGateway").resolveUserDataDir(), CATALOG_CACHE_FILENAME);
}

function readPersistedCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogCacheFilePath(), "utf8"));
    const catalog = validateCatalog(parsed?.catalog);
    if (!catalog) return null;
    return {
      ...catalog,
      source: "persisted",
      fetchedAt: parsed.fetchedAt ?? null,
      accountKey: typeof parsed.accountKey === "string" ? parsed.accountKey : null,
    };
  } catch {
    return null;
  }
}

function persistCatalog(catalog, fetchedAt, accountKey) {
  try {
    const filePath = catalogCacheFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ fetchedAt, accountKey, catalog }));
  } catch {
    // best-effort; the memory copy still serves this session
  }
}

function belongsToAnotherAccount(catalog, accountKey) {
  return Boolean(accountKey && catalog?.accountKey && catalog.accountKey !== accountKey);
}

function getCatalog() {
  const accountKey = currentAccountKey();
  if (accountKey && lastSeenAccountKey && accountKey !== lastSeenAccountKey) {
    modelCooldowns.clear();
  }
  if (accountKey) lastSeenAccountKey = accountKey;

  if (!memoryCatalog) memoryCatalog = readPersistedCatalog();
  if (belongsToAnotherAccount(memoryCatalog, accountKey)) {
    memoryCatalog = null;
    onAccountChanged();
  }
  return memoryCatalog || STATIC_FALLBACK_CATALOG;
}

async function doRefresh({ reason, op, fetchImpl, getAccessToken, getProjectId }) {
  const gateway = require("./antigravityGateway");
  const operation =
    op || createAntigravityOperation({ budgetMs: CATALOG_BUDGET_MS, label: "antigravity-catalog" });
  const auth = await (getAccessToken || require("./antigravityAuth").getAntigravityAccessToken)({
    signal: operation.signal,
  });
  const projectId = await (getProjectId || gateway.getAntigravityProjectId)({
    accessToken: auth.accessToken,
    accountKey: auth.accountKey,
    fetchImpl,
    op: operation,
  });
  const payload = await gateway.postGatewayJson({
    accessToken: auth.accessToken,
    method: "fetchAvailableModels",
    body: { project: projectId },
    fetchImpl,
    op: operation,
  });
  const catalog = validateCatalog(payload);
  if (!catalog) {
    throw createAntigravityError(
      "AGY_CATALOG_INVALID",
      "fetchAvailableModels returned an unexpected shape"
    );
  }
  const fetchedAt = Date.now();
  const accountKey = auth.accountKey || null;
  memoryCatalog = { ...catalog, source: "remote", fetchedAt, accountKey };
  persistCatalog(catalog, fetchedAt, accountKey);
  debugLogger.info(
    "Antigravity model catalog refreshed",
    { reason, models: Object.keys(catalog.models).length },
    "antigravity"
  );
  return memoryCatalog;
}

/**
 * refreshCatalog({ reason, op }) -> Promise<catalog>. Single-flight. On any
 * failure the last good catalog stays in place and the error propagates.
 */
function refreshCatalog({
  reason = "manual",
  op,
  fetchImpl = fetch,
  getAccessToken,
  getProjectId,
} = {}) {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh({ reason, op, fetchImpl, getAccessToken, getProjectId }).finally(
      () => {
        inFlightRefresh = null;
      }
    );
  }
  return inFlightRefresh;
}

function refreshQuietly(reason) {
  refreshCatalog({ reason }).catch((error) => {
    debugLogger.warn(
      "Antigravity model catalog refresh failed",
      { reason, code: error?.code },
      "antigravity"
    );
  });
}

let lastUnavailableRefreshAt = 0;

// Call when a request fails with AGY_MODEL_UNAVAILABLE (404 or retirement
// notice): the server has probably rotated models, so re-read the catalog,
// at most once per minute.
function notifyModelUnavailable(now = Date.now()) {
  if (now - lastUnavailableRefreshAt < MODEL_UNAVAILABLE_DEBOUNCE_MS) return false;
  lastUnavailableRefreshAt = now;
  refreshQuietly("model-unavailable");
  return true;
}

let startupTimer = null;
let intervalTimer = null;

function startAntigravityCatalogRefresh() {
  if (intervalTimer) return;
  startupTimer = setTimeout(() => refreshQuietly("startup"), CATALOG_STARTUP_DELAY_MS);
  startupTimer.unref?.();
  intervalTimer = setInterval(() => refreshQuietly("interval"), CATALOG_REFRESH_INTERVAL_MS);
  intervalTimer.unref?.();
}

function stopAntigravityCatalogRefresh() {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = null;
  intervalTimer = null;
}

function _resetCatalogForTests() {
  lastSeenAccountKey = null;
  memoryCatalog = null;
  inFlightRefresh = null;
  lastUnavailableRefreshAt = 0;
  modelCooldowns.clear();
}

module.exports = {
  PINNED_FALLBACK_MODEL,
  STATIC_FALLBACK_CATALOG,
  validateCatalog,
  getCatalog,
  refreshCatalog,
  notifyModelUnavailable,
  resolveAntigravityModels,
  emptyCandidatesError,
  listSelectableModels,
  markModelCooldown,
  clearModelCooldowns,
  startAntigravityCatalogRefresh,
  stopAntigravityCatalogRefresh,
  _resetCatalogForTests,
  _setAccountKeyResolverForTests,
};
