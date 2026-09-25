// Antigravity (agy) Cloud Code Assist gateway (A3). Every network call here is
// bounded by an antigravityOperation so a stalled request can never hang
// forever (the old code had no timeout at all; a probe hung >2 minutes), and
// every failure surfaces as a typed AGY_* error with the real HTTP status
// instead of the old behavior of quietly rewriting 404s/exhaustion as 429s.
//
// Only the daily Cloud Code base is used for generation: the prod base
// (cloudcode-pa) answers 429 for every model on this consumer account tier,
// so failing over to it just burns budget for a guaranteed second failure.
const { randomUUID } = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createAntigravityOperation,
  createAntigravityError,
  classifyAbortError,
} = require("./antigravityOperation");

const DAILY_CLOUDCODE_BASE = "https://daily-cloudcode-pa.googleapis.com";
// Kept only for reference/back-compat of anything reading it; no request in
// this module targets it anymore (see module comment above).
const PROD_CLOUDCODE_BASE = "https://cloudcode-pa.googleapis.com";

// Pinned known-good STT backend model: measured 1.4-1.9s per clip (warm),
// vs. 9-12.5s for the id this used to hardcode. Used whenever a caller asks
// for a synthetic transcription-mode id ("gemini-3.5-transcribe*") or omits
// a model, rather than looping through a candidate list on failure (that
// kind of runtime failover is wave 2 / A5 — this is a single fixed choice).
const DEFAULT_STT_BACKEND_MODEL = "gemini-2.5-flash-lite";

const ANTIGRAVITY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Antigravity/1.0.14";
const CLIENT_METADATA = JSON.stringify({
  ideType: "ANTIGRAVITY",
  platform: "MACOS",
  pluginType: "GEMINI",
});

const DEFAULT_SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

// Default per-call budgets when a caller doesn't build its own operation
// (full request-scoped budgets driven by IPC cancel ids/audio length is A2,
// still open for wave 2 — see the handoff notes). These are just sane caps
// so nothing can hang indefinitely.
const PROJECT_ID_STAGE_BUDGET_MS = 8_000;
const DEFAULT_OPERATION_BUDGET_MS = 25_000;

function gatewayHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": CLIENT_METADATA,
  };
}

function resolveBackendModel(model) {
  const trimmed = String(model || "").trim();
  if (!trimmed || trimmed.startsWith("gemini-3.5-transcribe")) {
    return DEFAULT_STT_BACKEND_MODEL;
  }
  return trimmed;
}

// Anchored retirement-notice detector: only fires when the WHOLE trimmed
// response is short (a retirement notice is one or two sentences) AND
// matches the notice shape. Without the length bound, a legitimately
// dictated/generated long text that happens to quote or discuss a
// retirement notice would be misclassified as the notice itself.
const RETIREMENT_NOTICE_MAX_CHARS = 300;
const RETIREMENT_NOTICE_RE = /is no longer available.{0,120}?(?:switch to|use)/i;

function isModelRetirementNotice(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed || trimmed.length >= RETIREMENT_NOTICE_MAX_CHARS) return false;
  return RETIREMENT_NOTICE_RE.test(trimmed);
}

function deepFindProjectId(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.cloudaicompanionProject === "string") return payload.cloudaicompanionProject;
  if (typeof payload.cloudaicompanion_project === "string") return payload.cloudaicompanion_project;
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      const nested = deepFindProjectId(value);
      if (nested) return nested;
    }
  }
  return null;
}

function extractResponseText(responseBody) {
  const response = responseBody?.response || responseBody;
  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((part) => part?.thought !== true)
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  if (typeof response?.text === "string") {
    return response.text.trim();
  }
  return "";
}

function extractFinishReason(responseBody) {
  const response = responseBody?.response || responseBody;
  return response?.candidates?.[0]?.finishReason ?? null;
}

// --- Typed error classification -------------------------------------------

/**
 * RetryInfo/retryDelay parsing (best-effort): Google's RPC error details
 * carry either `{ retryDelay: "12s" }` (protobuf Duration JSON string form)
 * or `{ retryDelay: { seconds, nanos } }`. Either shape maps to milliseconds.
 */
function extractRetryAfterMs(payload, headers) {
  const details = payload?.error?.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const retryDelay = detail?.retryDelay ?? detail?.retryInfo?.retryDelay;
      if (typeof retryDelay === "string") {
        const match = retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
        if (match) return Math.round(parseFloat(match[1]) * 1000);
      } else if (retryDelay && typeof retryDelay === "object") {
        const seconds = Number(retryDelay.seconds || 0);
        const nanos = Number(retryDelay.nanos || 0);
        return Math.round(seconds * 1000 + nanos / 1e6);
      }
    }
  }
  const headerValue = typeof headers?.get === "function" ? headers.get("retry-after") : null;
  if (headerValue) {
    const asSeconds = Number(headerValue);
    if (Number.isFinite(asSeconds)) return asSeconds * 1000;
  }
  return undefined;
}

// Heuristic, not a documented API contract: the gateway doesn't return a
// machine-readable "which quota bucket" field, only free text. Wording that
// mentions a daily/overall quota being exhausted blocks every model on the
// account until it resets ("account" scope); a bare "too many requests" /
// rate-limit phrasing is specific to the one model just called and a
// different candidate could still succeed right now ("model" scope).
function classifyRateLimitScope(message) {
  const text = String(message || "").toLowerCase();
  const accountExhausted =
    /daily quota/.test(text) ||
    /quota.{0,20}(exhaust|exceed)/.test(text) ||
    /(exhaust|exceed).{0,20}quota/.test(text) ||
    /out of quota/.test(text);
  return accountExhausted ? "account" : "model";
}

function throwTypedGatewayError(status, bodyText, payload, headers) {
  const message =
    (typeof payload?.error?.message === "string" && payload.error.message.trim()) ||
    (typeof payload?.message === "string" && payload.message.trim()) ||
    bodyText ||
    `Antigravity gateway request failed (${status})`;

  if (status === 429) {
    const scope = classifyRateLimitScope(message);
    throw createAntigravityError("AGY_RATE_LIMITED", message, {
      status,
      retryAfterMs: extractRetryAfterMs(payload, headers),
      scope,
      // Same renderer i18n keys the old QUOTA_EXCEEDED path surfaced.
      messageKey:
        scope === "account"
          ? "hooks.audioRecording.errorDescriptions.antigravityQuotaExceeded"
          : "hooks.audioRecording.errorDescriptions.providerRateLimited",
    });
  }
  if (status === 404) {
    throw createAntigravityError("AGY_MODEL_UNAVAILABLE", message, { status });
  }
  throw createAntigravityError("AGY_HTTP", message, { status });
}

function wrapFetchAbort(error, operation) {
  if (error?.name === "AbortError" || error?.name === "TimeoutError") {
    const code = classifyAbortError(error, operation.callerSignal);
    return createAntigravityError(
      code,
      code === "AGY_CANCELLED" ? "Antigravity request cancelled" : "Antigravity request timed out"
    );
  }
  return error;
}

function ensureOperation(op, budgetMs, label) {
  return op || createAntigravityOperation({ budgetMs, label });
}

async function readJsonBody(response) {
  // Prefer .text() (works for both real fetch Responses and simple test
  // doubles that mock it); fall back to .json() for doubles that only mock
  // that instead, so both mocking styles used across the antigravity test
  // suite keep working.
  if (typeof response.text === "function") {
    const bodyText = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(bodyText);
    } catch {
      // non-JSON error body; classifyGatewayError falls back to the raw text
    }
    return { bodyText, payload };
  }
  if (typeof response.json === "function") {
    const payload = await response.json().catch(() => ({}));
    return { bodyText: JSON.stringify(payload), payload };
  }
  return { bodyText: "", payload: {} };
}

// --- Incremental SSE parsing ------------------------------------------------

/**
 * Reads a `streamGenerateContent?alt=sse` response incrementally, buffering
 * only the trailing partial line across chunks (a `data: {...}` line can
 * arrive split across two network reads) rather than materializing the
 * whole response before parsing. Skips `part.thought === true` parts (Gemini
 * "thinking" trace, never spoken/displayed content) and tracks the last
 * `finishReason` seen across all streamed candidates.
 *
 * Also collects the raw non-thought parts (text and functionCall alike,
 * each keeping its `thoughtSignature` verbatim when present) into `parts`
 * so callers that need native function calling (the chat tool loop) don't
 * have to re-walk the stream a second time.
 */
async function readSseStream(response) {
  let buffer = "";
  let text = "";
  let finishReason = null;
  const parts = [];

  const processLine = (rawLine) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return; // tolerate a malformed/garbage SSE line rather than aborting
    }
    const candidate = chunk?.response?.candidates?.[0] ?? chunk?.candidates?.[0];
    if (typeof candidate?.finishReason === "string" && candidate.finishReason) {
      finishReason = candidate.finishReason;
    }
    const candidateParts = candidate?.content?.parts;
    if (Array.isArray(candidateParts)) {
      for (const part of candidateParts) {
        if (part?.thought === true) continue;
        if (typeof part?.text === "string") text += part.text;
        if (typeof part?.text === "string" || part?.functionCall) {
          const kept = { thoughtSignature: part.thoughtSignature };
          if (typeof part.text === "string") kept.text = part.text;
          if (part.functionCall) kept.functionCall = part.functionCall;
          parts.push(kept);
        }
      }
    }
  };

  const consumeChunk = (chunkStr) => {
    buffer += chunkStr;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  };

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    // Web ReadableStream (undici's global fetch — the production path).
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeChunk(decoder.decode(value, { stream: true }));
      }
      consumeChunk(decoder.decode());
    } finally {
      reader.releaseLock?.();
    }
  } else if (body && typeof body[Symbol.asyncIterator] === "function") {
    // Node Readable stream, in case a fetch polyfill ever returns one.
    for await (const chunk of body) {
      consumeChunk(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    }
  } else if (typeof response.text === "function") {
    // Fallback for lightweight test doubles that only mock .text() — real
    // fetch Responses always have a streaming .body, handled above, so this
    // path never runs in production.
    consumeChunk(await response.text());
  }
  if (buffer) processLine(buffer);

  return { text: text.trim(), finishReason, parts };
}

// --- Project id / loadCodeAssist -------------------------------------------

async function loadCodeAssistFromBase(base, accessToken, fetchImpl, operation, projectHint) {
  let response;
  try {
    response = await fetchImpl(`${base}/v1internal:loadCodeAssist`, {
      method: "POST",
      headers: gatewayHeaders(accessToken),
      body: projectHint ? JSON.stringify({ cloudaicompanionProject: projectHint }) : "{}",
      signal: operation.stageSignal(PROJECT_ID_STAGE_BUDGET_MS),
    });
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }
  const { bodyText, payload } = await readJsonBody(response);
  if (!response.ok) {
    throwTypedGatewayError(response.status, bodyText, payload, response.headers);
  }
  const projectId = deepFindProjectId(payload);
  if (!projectId) {
    throw createAntigravityError(
      "AGY_ERROR",
      "Antigravity project ID missing from loadCodeAssist response"
    );
  }
  return { projectId, base };
}

async function loadCodeAssist({
  accessToken,
  fetchImpl = fetch,
  base = DAILY_CLOUDCODE_BASE,
  op,
} = {}) {
  const operation = ensureOperation(
    op,
    PROJECT_ID_STAGE_BUDGET_MS + 2_000,
    "antigravity-loadCodeAssist"
  );
  return loadCodeAssistFromBase(base, accessToken, fetchImpl, operation, null);
}

// userData dir is injectable for tests so persisted project-id caching never
// touches a real Electron userData directory when this runs under plain
// node:test (see _setUserDataDirForTests).
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

const PROJECT_ID_CACHE_FILENAME = "antigravity-project-id-cache.json";

function projectIdCacheFilePath() {
  return path.join(resolveUserDataDir(), PROJECT_ID_CACHE_FILENAME);
}

function readProjectIdCacheFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectIdCacheFilePath(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeProjectIdCacheEntry(accountKey, projectId) {
  try {
    const all = readProjectIdCacheFile();
    all[accountKey] = { projectId, updatedAt: Date.now() };
    fs.mkdirSync(path.dirname(projectIdCacheFilePath()), { recursive: true });
    fs.writeFileSync(projectIdCacheFilePath(), JSON.stringify(all));
  } catch {
    // best-effort; memory cache still has it for this process lifetime
  }
}

function agyProjectHintFilePath() {
  return path.join(os.homedir(), ".gemini", "antigravity-cli", "cache", "default_project_id.txt");
}

function readAgyProjectHint() {
  try {
    const text = fs.readFileSync(agyProjectHintFilePath(), "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

const memoryProjectIdCache = new Map();

function _resetProjectIdCacheForTests() {
  memoryProjectIdCache.clear();
}

/**
 * getAntigravityProjectId({ accessToken, accountKey, fetchImpl, op }) ->
 *   Promise<string>
 *
 * Resolution order: (1) in-memory cache for this accountKey, (2) the
 * persisted per-account userData cache, (3) agy's own cached project-id hint
 * file — validated with one real loadCodeAssist call before being trusted,
 * never used blind, (4) a fresh loadCodeAssist discovery call. Whichever tier
 * resolves it gets cached back into memory + the persisted file.
 */
async function getAntigravityProjectId({
  accessToken,
  accountKey,
  fetchImpl = fetch,
  base = DAILY_CLOUDCODE_BASE,
  op,
} = {}) {
  const key = accountKey || "default";
  if (memoryProjectIdCache.has(key)) {
    return memoryProjectIdCache.get(key);
  }

  const persisted = readProjectIdCacheFile()[key]?.projectId;
  if (persisted) {
    memoryProjectIdCache.set(key, persisted);
    return persisted;
  }

  const operation = ensureOperation(
    op,
    PROJECT_ID_STAGE_BUDGET_MS + 2_000,
    "antigravity-project-id"
  );

  const hint = readAgyProjectHint();
  if (hint) {
    try {
      const { projectId } = await loadCodeAssistFromBase(
        base,
        accessToken,
        fetchImpl,
        operation,
        hint
      );
      if (projectId) {
        memoryProjectIdCache.set(key, projectId);
        writeProjectIdCacheEntry(key, projectId);
        return projectId;
      }
    } catch {
      // hint didn't validate (stale, wrong account, etc.) — fall through to
      // a fresh, hint-free discovery call below.
    }
  }

  const { projectId } = await loadCodeAssistFromBase(base, accessToken, fetchImpl, operation, null);
  memoryProjectIdCache.set(key, projectId);
  writeProjectIdCacheEntry(key, projectId);
  return projectId;
}

// Plain JSON RPC against the gateway (e.g. fetchAvailableModels), with the
// same bounded signal and typed errors as the generation calls.
async function postGatewayJson({
  accessToken,
  method,
  body,
  fetchImpl = fetch,
  base = DAILY_CLOUDCODE_BASE,
  op,
  stageMs = PROJECT_ID_STAGE_BUDGET_MS,
}) {
  const operation = ensureOperation(op, stageMs + 2_000, `antigravity-${method}`);
  let response;
  try {
    response = await fetchImpl(`${base}/v1internal:${method}`, {
      method: "POST",
      headers: gatewayHeaders(accessToken),
      body: JSON.stringify(body ?? {}),
      signal: operation.stageSignal(stageMs),
    });
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }
  const { bodyText, payload } = await readJsonBody(response);
  if (!response.ok) {
    throwTypedGatewayError(response.status, bodyText, payload, response.headers);
  }
  return payload;
}

// --- Generation --------------------------------------------------------

function buildEnvelope({ projectId, model, request }) {
  const inner = { ...request };
  if (!inner.safetySettings) {
    inner.safetySettings = DEFAULT_SAFETY_SETTINGS;
  }
  return {
    project: projectId,
    model: resolveBackendModel(model),
    request: inner,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `openwhispr-${randomUUID()}`,
  };
}

function checkFinishReason(finishReason) {
  if (finishReason === "MAX_TOKENS") {
    throw createAntigravityError("AGY_TRUNCATED", "Antigravity response truncated at max tokens", {
      finishReason,
    });
  }
  if (finishReason === "SAFETY") {
    throw createAntigravityError("AGY_BLOCKED", "Antigravity response blocked by safety filters", {
      finishReason,
    });
  }
}

async function generateContent({
  accessToken,
  projectId,
  model,
  request,
  fetchImpl = fetch,
  base = DAILY_CLOUDCODE_BASE,
  op,
  stageMs,
}) {
  const operation = ensureOperation(op, DEFAULT_OPERATION_BUDGET_MS, "antigravity-generateContent");
  const envelope = buildEnvelope({ projectId, model, request });

  let response;
  try {
    response = await fetchImpl(`${base}/v1internal:generateContent`, {
      method: "POST",
      headers: gatewayHeaders(accessToken),
      body: JSON.stringify(envelope),
      signal: operation.stageSignal(stageMs ?? operation.remainingMs()),
    });
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }

  const { bodyText, payload } = await readJsonBody(response);
  if (!response.ok) {
    throwTypedGatewayError(response.status, bodyText, payload, response.headers);
  }

  const finishReason = extractFinishReason(payload);
  checkFinishReason(finishReason);
  const text = extractResponseText(payload);
  if (!text) {
    throw createAntigravityError("AGY_EMPTY_OUTPUT", "Antigravity returned no text content");
  }
  if (isModelRetirementNotice(text)) {
    throw createAntigravityError("AGY_MODEL_UNAVAILABLE", text);
  }
  return { text, raw: payload, base, finishReason };
}

async function streamGenerateContent({
  accessToken,
  base = DAILY_CLOUDCODE_BASE,
  projectId,
  model,
  request,
  fetchImpl = fetch,
  op,
  stageMs,
}) {
  const operation = ensureOperation(
    op,
    DEFAULT_OPERATION_BUDGET_MS,
    "antigravity-streamGenerateContent"
  );
  const envelope = buildEnvelope({ projectId, model, request });

  let response;
  try {
    response = await fetchImpl(`${base}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: gatewayHeaders(accessToken),
      body: JSON.stringify(envelope),
      signal: operation.stageSignal(stageMs ?? operation.remainingMs()),
    });
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }

  if (!response.ok) {
    const { bodyText, payload } = await readJsonBody(response);
    throwTypedGatewayError(response.status, bodyText, payload, response.headers);
  }

  let parsed;
  try {
    parsed = await readSseStream(response);
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }

  checkFinishReason(parsed.finishReason);
  if (!parsed.text) {
    throw createAntigravityError("AGY_EMPTY_OUTPUT", "Antigravity returned no text content");
  }
  if (isModelRetirementNotice(parsed.text)) {
    throw createAntigravityError("AGY_MODEL_UNAVAILABLE", parsed.text);
  }
  return { text: parsed.text, finishReason: parsed.finishReason };
}

/**
 * One chat-tool-loop turn (Phase B): a single streamGenerateContent call
 * carrying the full structured conversation (`contents`) and, when tools
 * are offered, native Gemini `functionDeclarations` + AUTO tool-calling.
 * Unlike streamGenerateContent/generateContent above, an empty `text` is
 * not itself an error here — a turn that only returns functionCall parts
 * (no text) is the normal shape of a tool-invoking response. Retirement
 * detection only runs on a text-only response (a functionCall is never
 * mistaken for one).
 */
async function streamChatTurn({
  accessToken,
  base = DAILY_CLOUDCODE_BASE,
  projectId,
  model,
  systemInstruction,
  contents,
  functionDeclarations,
  thinkingLevel = "low",
  fetchImpl = fetch,
  op,
  stageMs,
}) {
  const operation = ensureOperation(op, DEFAULT_OPERATION_BUDGET_MS, "antigravity-chatTurn");
  const request = { contents };
  if (systemInstruction) request.systemInstruction = systemInstruction;
  if (Array.isArray(functionDeclarations) && functionDeclarations.length > 0) {
    request.tools = [{ functionDeclarations }];
    request.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }
  request.generationConfig = { thinkingConfig: { thinkingLevel } };

  const envelope = buildEnvelope({ projectId, model, request });
  let response;
  try {
    response = await fetchImpl(`${base}/v1internal:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: gatewayHeaders(accessToken),
      body: JSON.stringify(envelope),
      signal: operation.stageSignal(stageMs ?? operation.remainingMs()),
    });
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }

  if (!response.ok) {
    const { bodyText, payload } = await readJsonBody(response);
    throwTypedGatewayError(response.status, bodyText, payload, response.headers);
  }

  let parsed;
  try {
    parsed = await readSseStream(response);
  } catch (error) {
    throw wrapFetchAbort(error, operation);
  }

  checkFinishReason(parsed.finishReason);

  const functionCalls = [];
  const textParts = [];
  for (const part of parsed.parts) {
    if (part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name,
        args: part.functionCall.args && typeof part.functionCall.args === "object"
          ? part.functionCall.args
          : {},
        thoughtSignature: part.thoughtSignature,
        ...(typeof part.functionCall.id === "string" ? { id: part.functionCall.id } : {}),
      });
    } else if (typeof part.text === "string" && part.text) {
      textParts.push({ text: part.text, thoughtSignature: part.thoughtSignature });
    }
  }

  if (!parsed.text && functionCalls.length === 0) {
    throw createAntigravityError("AGY_EMPTY_OUTPUT", "Antigravity returned no content");
  }
  if (functionCalls.length === 0 && isModelRetirementNotice(parsed.text)) {
    throw createAntigravityError("AGY_MODEL_UNAVAILABLE", parsed.text);
  }

  return { text: parsed.text, textParts, functionCalls, finishReason: parsed.finishReason };
}

function buildTranscriptionSystemPrompt({ mode, language, keyterms }) {
  const lines = [
    "You are a speech-to-text engine.",
    mode === "VERBATIM"
      ? "Transcribe the audio verbatim with exact wording and punctuation."
      : "Transcribe the audio faithfully with natural punctuation and capitalization.",
    "Output ONLY the transcript in the original spoken language.",
    "Do not summarize, translate, explain, or add commentary.",
  ];
  if (language && language !== "auto") {
    lines.push(`Expected spoken language: ${language}.`);
  }
  if (keyterms?.length) {
    lines.push(`Vocabulary hints: ${keyterms.join(", ")}.`);
  }
  return lines.join("\n");
}

/**
 * Single attempt against one resolved model — no candidate cascading. If the
 * model 404s, is retired, times out, etc. the typed error propagates to the
 * caller; trying a different candidate model/path is wave 2 (A5 failover).
 */
async function transcribeAudioViaGateway({
  accessToken,
  projectId,
  accountKey,
  model,
  audioBase64,
  mimeType,
  language,
  keyterms,
  mode = "SMART",
  fetchImpl = fetch,
  gatewayBase = DAILY_CLOUDCODE_BASE,
  op,
}) {
  const operation = ensureOperation(op, DEFAULT_OPERATION_BUDGET_MS, "antigravity-stt");

  const resolvedProjectId =
    projectId ||
    (await getAntigravityProjectId({
      accessToken,
      accountKey,
      fetchImpl,
      base: gatewayBase,
      op: operation,
    }));

  const request = {
    systemInstruction: {
      parts: [{ text: buildTranscriptionSystemPrompt({ mode, language, keyterms }) }],
    },
    contents: [
      {
        role: "user",
        parts: [{ inlineData: { mimeType, data: audioBase64 } }],
      },
    ],
    generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
  };

  const backendModel = resolveBackendModel(model);
  const { text, finishReason } = await streamGenerateContent({
    accessToken,
    base: gatewayBase,
    projectId: resolvedProjectId,
    model: backendModel,
    fetchImpl,
    request,
    op: operation,
    stageMs: operation.remainingMs(),
  });

  return { text, model: backendModel, base: gatewayBase, finishReason };
}

async function generateTextViaGateway({
  accessToken,
  projectId,
  accountKey,
  model,
  systemPrompt,
  userText,
  fetchImpl = fetch,
  gatewayBase = DAILY_CLOUDCODE_BASE,
  op,
}) {
  const operation = ensureOperation(op, DEFAULT_OPERATION_BUDGET_MS, "antigravity-generateText");
  const resolvedProjectId =
    projectId ||
    (await getAntigravityProjectId({
      accessToken,
      accountKey,
      fetchImpl,
      base: gatewayBase,
      op: operation,
    }));

  const parts = [{ text: userText }];
  const request = { contents: [{ role: "user", parts }] };
  if (systemPrompt?.trim()) {
    request.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
  }
  const backendModel = resolveBackendModel(model);
  if (backendModel.includes("flash")) {
    request.generationConfig = { thinkingConfig: { thinkingLevel: "low" } };
  }
  const { text } = await generateContent({
    accessToken,
    projectId: resolvedProjectId,
    model: backendModel,
    request,
    fetchImpl,
    base: gatewayBase,
    op: operation,
    stageMs: operation.remainingMs(),
  });
  return text.trim();
}

module.exports = {
  DAILY_CLOUDCODE_BASE,
  PROD_CLOUDCODE_BASE,
  DEFAULT_STT_BACKEND_MODEL,
  loadCodeAssist,
  getAntigravityProjectId,
  postGatewayJson,
  resolveUserDataDir,
  generateContent,
  streamGenerateContent,
  streamChatTurn,
  transcribeAudioViaGateway,
  generateTextViaGateway,
  extractResponseText,
  buildTranscriptionSystemPrompt,
  resolveBackendModel,
  isModelRetirementNotice,
  classifyRateLimitScope,
  extractRetryAfterMs,
  _setUserDataDirForTests,
  _resetProjectIdCacheForTests,
};
