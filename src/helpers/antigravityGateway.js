const { randomUUID } = require("crypto");
const { classifyAgyError } = require("./antigravityCli");
const { markGatewayQuotaExhausted, clearGatewayQuotaCache } = require("./antigravityQuotaCache");

// ponytail: agy CLI uses daily first; prod transcribe model often 429 while daily flash multimodal works.
const DAILY_CLOUDCODE_BASE = "https://daily-cloudcode-pa.googleapis.com";
const PROD_CLOUDCODE_BASE = "https://cloudcode-pa.googleapis.com";
const CLOUDCODE_BASES = [DAILY_CLOUDCODE_BASE, PROD_CLOUDCODE_BASE];

const ANTIGRAVITY_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Antigravity/1.0.14";
const CLIENT_METADATA = JSON.stringify({
  ideType: "ANTIGRAVITY",
  platform: "MACOS",
  pluginType: "GEMINI",
});

const STT_BACKEND_MODEL = "gemini-3.5-flash-low";

const DEFAULT_SAFETY_SETTINGS = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
].map((category) => ({ category, threshold: "BLOCK_NONE" }));

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
  if (!trimmed) return "gemini-3.5-transcribe";
  if (trimmed.startsWith("gemini-3.5-transcribe")) return trimmed;
  return trimmed;
}

function deepFindProjectId(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.cloudaicompanionProject === "string") return payload.cloudaicompanionProject;
  if (typeof payload.cloudaicompanion_project === "string") return payload.cloudaicompanion_project;
  for (const value of Object.values(payload)) {
    if (typeof value === "object") {
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
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
      .trim();
  }
  if (typeof response?.text === "string") {
    return response.text.trim();
  }
  return "";
}

function parseStreamGenerateContentSse(rawBody) {
  let text = "";
  for (const line of String(rawBody || "").split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      for (const part of chunk.response?.candidates?.[0]?.content?.parts || []) {
        if (typeof part?.text === "string") {
          text += part.text;
        }
      }
    } catch {
      // skip malformed SSE chunk
    }
  }
  return text.trim();
}

function parseGatewayErrorMessage(bodyText) {
  try {
    const payload = JSON.parse(bodyText);
    const message = payload?.error?.message ?? payload?.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  } catch {
    // not JSON — classifyAgyError uses the raw body
  }
  return null;
}

function throwGatewayFailure(status, bodyText) {
  const classified = classifyAgyError(bodyText);
  const parsed = parseGatewayErrorMessage(bodyText);
  const error = new Error(
    classified.code === "QUOTA_EXCEEDED"
      ? "Antigravity subscription quota exhausted. Wait a few minutes and try again."
      : parsed || classified.message
  );
  error.code = classified.code;
  error.status = status;
  if (classified.code === "QUOTA_EXCEEDED") {
    markGatewayQuotaExhausted();
    error.messageKey = "hooks.audioRecording.errorDescriptions.antigravityQuotaExceeded";
  } else if (status === 429) {
    error.messageKey = "hooks.audioRecording.errorDescriptions.providerRateLimited";
  }
  throw error;
}

const sleep = (ms, sleepFn) =>
  sleepFn ? sleepFn(ms) : new Promise((resolve) => setTimeout(resolve, ms));
const QUOTA_RETRY_DELAYS_MS = [2000, 5000];

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

async function loadCodeAssistFromBase(base, accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(`${base}/v1internal:loadCodeAssist`, {
    method: "POST",
    headers: gatewayHeaders(accessToken),
    body: "{}",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throwGatewayFailure(response.status, JSON.stringify(payload));
  }
  const projectId = deepFindProjectId(payload);
  if (!projectId) {
    const error = new Error("Antigravity project ID missing from loadCodeAssist response");
    error.code = "AGY_ERROR";
    throw error;
  }
  return projectId;
}

async function loadCodeAssist({ accessToken, fetchImpl = fetch, base = DAILY_CLOUDCODE_BASE }) {
  const bases = [base, ...CLOUDCODE_BASES.filter((candidate) => candidate !== base)];
  let lastError;
  for (const candidate of bases) {
    try {
      const projectId = await loadCodeAssistFromBase(candidate, accessToken, fetchImpl);
      return { projectId, base: candidate };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function streamGenerateContent({
  accessToken,
  base,
  projectId,
  model,
  request,
  fetchImpl = fetch,
}) {
  const inner = { ...request };
  if (!inner.safetySettings) {
    inner.safetySettings = DEFAULT_SAFETY_SETTINGS;
  }

  const envelope = {
    project: projectId,
    model: resolveBackendModel(model),
    request: inner,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `openwhispr-${randomUUID()}`,
  };

  const response = await fetchImpl(`${base}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: gatewayHeaders(accessToken),
    body: JSON.stringify(envelope),
  });
  const rawBody = await response.text();
  if (!response.ok) {
    throwGatewayFailure(response.status, rawBody);
  }
  const text = parseStreamGenerateContentSse(rawBody);
  return { text, raw: rawBody };
}

async function generateContent({
  accessToken,
  projectId,
  model,
  request,
  fetchImpl = fetch,
  retryDelaysMs = QUOTA_RETRY_DELAYS_MS,
  sleepFn,
  base,
}) {
  const backendModel = resolveBackendModel(model);
  const inner = { ...request };
  if (!inner.safetySettings) {
    inner.safetySettings = DEFAULT_SAFETY_SETTINGS;
  }

  const envelope = {
    project: projectId,
    model: backendModel,
    request: inner,
    requestType: "agent",
    userAgent: "antigravity",
    requestId: `openwhispr-${randomUUID()}`,
  };

  const bases = base
    ? [base, ...CLOUDCODE_BASES.filter((candidate) => candidate !== base)]
    : CLOUDCODE_BASES;

  let lastBody = "";
  for (const candidateBase of bases) {
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
      const response = await fetchImpl(`${candidateBase}/v1internal:generateContent`, {
        method: "POST",
        headers: gatewayHeaders(accessToken),
        body: JSON.stringify(envelope),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        clearGatewayQuotaCache();
        return { text: extractResponseText(payload), raw: payload, base: candidateBase };
      }
      lastBody = JSON.stringify(payload);
      if (response.status === 429 && attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt], sleepFn);
        continue;
      }
      if (response.status === 429 || response.status === 404) {
        break;
      }
      throwGatewayFailure(response.status, lastBody);
    }
  }
  throwGatewayFailure(429, lastBody);
}

async function transcribeAudioViaGateway({
  accessToken,
  projectId,
  model,
  audioBase64,
  mimeType,
  language,
  keyterms,
  mode = "SMART",
  fetchImpl = fetch,
  gatewayBase,
}) {
  let resolvedBase = gatewayBase || DAILY_CLOUDCODE_BASE;
  let resolvedProjectId = projectId;

  if (!resolvedProjectId || (gatewayBase && gatewayBase !== DAILY_CLOUDCODE_BASE)) {
    const loaded = await loadCodeAssist({
      accessToken,
      fetchImpl,
      base: DAILY_CLOUDCODE_BASE,
    });
    resolvedBase = loaded.base;
    resolvedProjectId = loaded.projectId;
  }

  const { text } = await streamGenerateContent({
    accessToken,
    base: resolvedBase,
    projectId: resolvedProjectId,
    model: STT_BACKEND_MODEL,
    fetchImpl,
    request: {
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
    },
  });

  if (!text) {
    const error = new Error("Antigravity transcription returned empty text");
    error.code = "AGY_EMPTY_TRANSCRIPT";
    throw error;
  }
  clearGatewayQuotaCache();
  return { text, model: STT_BACKEND_MODEL, base: resolvedBase };
}

async function generateTextViaGateway({
  accessToken,
  projectId,
  model,
  systemPrompt,
  userText,
  fetchImpl = fetch,
  gatewayBase,
}) {
  const parts = [{ text: userText }];
  const request = {
    contents: [{ role: "user", parts }],
  };
  if (systemPrompt?.trim()) {
    request.systemInstruction = { parts: [{ text: systemPrompt.trim() }] };
  }
  if (String(model || "").includes("flash")) {
    request.generationConfig = { thinkingConfig: { thinkingLevel: "low" } };
  }
  const { text } = await generateContent({
    accessToken,
    projectId,
    model: model || STT_BACKEND_MODEL,
    request,
    fetchImpl,
    retryDelaysMs: [],
    base: gatewayBase,
  });
  return text.trim();
}

module.exports = {
  CLOUDCODE_BASE: PROD_CLOUDCODE_BASE,
  DAILY_CLOUDCODE_BASE,
  PROD_CLOUDCODE_BASE,
  CLOUDCODE_BASES,
  STT_BACKEND_MODEL,
  loadCodeAssist,
  generateContent,
  streamGenerateContent,
  transcribeAudioViaGateway,
  generateTextViaGateway,
  extractResponseText,
  parseStreamGenerateContentSse,
  buildTranscriptionSystemPrompt,
  resolveBackendModel,
};
