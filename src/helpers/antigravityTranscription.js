const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const debugLogger = require("./debugLogger");
const { createAntigravityError, createAntigravityOperation } = require("./antigravityOperation");
const { getAntigravityAccessToken } = require("./antigravityAuth");
const { transcribeAudioViaGateway, getAntigravityProjectId } = require("./antigravityGateway");
const {
  getCatalog,
  notifyModelUnavailable,
  resolveAntigravityModels,
  emptyCandidatesError,
} = require("./antigravityModelCatalog");
const {
  decideAntigravityFailover,
  applyFailoverSideEffects,
  isNetworkUnreachableError,
  computeSttBudgetMs,
} = require("./antigravityFailover");
const {
  DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL,
  isAntigravityTranscribeModel,
} = require("./antigravityTranscriptionPolicy");
const { ensureWritableDir, runAgyTurn } = require("./antigravityCli");

const GEMINI_MIME_TYPES = {
  "audio/mpeg": "audio/mp3",
  "audio/mp4": "audio/aac",
};

// Bound for the ffmpeg conversion stage when there is an operation to derive
// a stage signal from. Also the fallback deadline (see
// ffmpegConversionSignal below) for callers that don't pass one — without a
// signal at all, a stuck ffmpeg process (e.g. a hung codec probe) held the
// request open indefinitely.
const FFMPEG_CONVERT_STAGE_BUDGET_MS = 120_000;
const DEFAULT_FFMPEG_CONVERT_TIMEOUT_MS = 20_000;

// Every ffmpeg conversion must get an abort signal, whether or not the
// caller threads through a budgeted `op`.
function ffmpegConversionSignal(op, timeoutMs = DEFAULT_FFMPEG_CONVERT_TIMEOUT_MS) {
  return op?.stageSignal
    ? op.stageSignal(FFMPEG_CONVERT_STAGE_BUDGET_MS)
    : AbortSignal.timeout(timeoutMs);
}

const TRANSCRIPTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
  },
  required: ["transcript"],
};

function extensionForContentType(contentType) {
  switch (contentType) {
    case "audio/wav":
    case "audio/x-wav":
      return ".wav";
    case "audio/mpeg":
    case "audio/mp3":
      return ".mp3";
    case "audio/mp4":
    case "audio/aac":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/flac":
      return ".flac";
    default:
      return ".webm";
  }
}

function mimeTypeForGateway(contentType, extension) {
  return GEMINI_MIME_TYPES[contentType] || (extension === ".wav" ? "audio/wav" : contentType);
}

function buildTranscriptionPrompt({ audioPath, writeFilePath, language, keyterms }) {
  const lines = [
    "Transcribe the attached audio file verbatim.",
    "Return ONLY the transcript in the original spoken language.",
    "Do not summarize, translate, explain, or add commentary.",
    `Audio file path (inside the added workspace directory): ${audioPath}`,
  ];
  if (language && language !== "auto") {
    lines.push(`Expected spoken language: ${language}.`);
  }
  if (keyterms && keyterms.length > 0) {
    lines.push(`Vocabulary hints: ${keyterms.join(", ")}.`);
  }
  if (writeFilePath) {
    lines.push(
      `Write the transcript to this absolute path: ${writeFilePath}`,
      "The written file is the deliverable; stdout may be empty."
    );
  }
  lines.push("Output only the transcript text.");
  return lines.join("\n");
}

function stripMarkdownFences(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/^```(?:json|text)?\s*([\s\S]*?)```$/i);
  return (fenced ? fenced[1] : trimmed).trim();
}

function parseTranscriptText(text) {
  const cleaned = stripMarkdownFences(text);
  if (!cleaned) {
    return "";
  }
  if (cleaned.startsWith("{")) {
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed?.transcript === "string") {
        return parsed.transcript.trim();
      }
    } catch {
      // fall through to raw text
    }
  }
  return cleaned;
}

function resolveSpawnableFfmpegPath(ffmpegPath) {
  if (!ffmpegPath || typeof ffmpegPath !== "string") return ffmpegPath;
  if (ffmpegPath.includes("app.asar") && !ffmpegPath.includes("app.asar.unpacked")) {
    return (
      require("./ffmpegUtils").getFFmpegPath() ||
      ffmpegPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1")
    );
  }
  return ffmpegPath;
}

function convertToWavAsync({ inputPath, outputPath, ffmpegPath, signal }) {
  const bin = resolveSpawnableFfmpegPath(ffmpegPath);
  return new Promise((resolve, reject) => {
    // Detached so ffmpeg gets its own process group on Unix: killing just
    // the direct child pid leaves any process ffmpeg itself forked (or, for
    // a shell wrapper, its own child) running as an orphan that keeps our
    // stdio pipes open, which kept a stuck-ffmpeg cancellation from actually
    // freeing the request.
    const child = spawn(bin, ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const killChild = () => {
      if (process.platform !== "win32" && Number.isInteger(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
          return;
        } catch {
          // Group kill failed (e.g. child already gone, or it isn't its own
          // group leader for some reason) -- fall back to the direct pid.
        }
      }
      child.kill("SIGKILL");
    };
    const onAbort = () => {
      killChild();
      reject(createAntigravityError("AGY_CANCELLED", "Antigravity ffmpeg conversion cancelled"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort);
      if (code === 0) resolve();
      else reject(new Error((stderr || "").trim() || "ffmpeg conversion failed"));
    });
  });
}

function removeDirQuietly(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

async function prepareAudioBuffer({
  audioBuffer,
  contentType = "audio/webm",
  ffmpegPath,
  tmpRoot = os.tmpdir(),
  op,
  ffmpegTimeoutMs,
}) {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "openwhispr-antigravity-stt-"));
  const extension = extensionForContentType(contentType);
  const inputPath = path.join(tmpDir, `input${extension}`);
  const wavPath = path.join(tmpDir, "input.wav");

  ensureWritableDir(tmpDir);
  fs.writeFileSync(
    inputPath,
    Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
  );

  let readPath = inputPath;
  let mimeType = mimeTypeForGateway(contentType, extension);
  if (ffmpegPath && extension !== ".wav") {
    const ffmpegSignal = ffmpegConversionSignal(op, ffmpegTimeoutMs);
    await convertToWavAsync({ inputPath, outputPath: wavPath, ffmpegPath, signal: ffmpegSignal });
    readPath = wavPath;
    mimeType = "audio/wav";
  }

  const buffer = fs.readFileSync(readPath);
  removeDirQuietly(tmpDir);
  return { buffer, mimeType };
}

function buildAntigravitySttPrefs(model, antigravityPrefs = {}) {
  const sttPref =
    typeof antigravityPrefs.stt === "string" && antigravityPrefs.stt.trim()
      ? antigravityPrefs.stt.trim()
      : "auto";
  return {
    stt: sttPref,
    cleanup: antigravityPrefs.cleanup,
    chat: antigravityPrefs.chat,
  };
}

async function transcribeWithAntigravityLegacyAgent({
  audioBuffer,
  model,
  contentType,
  language,
  keyterms,
  command,
  ffmpegPath,
  tmpRoot = os.tmpdir(),
  runTurn = runAgyTurn,
  op,
  ffmpegTimeoutMs,
}) {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "openwhispr-antigravity-stt-legacy-"));
  const extension = extensionForContentType(contentType);
  const inputPath = path.join(tmpDir, `input${extension}`);
  const wavPath = path.join(tmpDir, "input.wav");
  const transcriptPath = path.join(tmpDir, "transcript.txt");

  try {
    ensureWritableDir(tmpDir);
    fs.writeFileSync(
      inputPath,
      Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer)
    );

    let audioPath = path.basename(inputPath);
    if (ffmpegPath && extension !== ".wav") {
      const ffmpegSignal = ffmpegConversionSignal(op, ffmpegTimeoutMs);
      await convertToWavAsync({ inputPath, outputPath: wavPath, ffmpegPath, signal: ffmpegSignal });
      audioPath = path.basename(wavPath);
    }

    const prompt = buildTranscriptionPrompt({
      audioPath,
      writeFilePath: transcriptPath,
      language,
      keyterms,
    });

    const turn = await runTurn({
      prompt,
      model: model || undefined,
      addDirs: [tmpDir],
      cwd: tmpDir,
      writeFilePath: transcriptPath,
      command,
      printTimeout: "45s",
      timeoutMs: Math.min(60_000, op?.remainingMs?.() || 60_000),
      extraArgs: ["--sandbox"],
      signal: op?.signal,
    });

    const writeFileText = fs.existsSync(transcriptPath)
      ? fs.readFileSync(transcriptPath, "utf8").trim()
      : "";
    const text = parseTranscriptText(writeFileText) || parseTranscriptText(turn.text);

    if (!text) {
      const error = new Error("Antigravity transcription returned empty text");
      error.code = "AGY_EMPTY_TRANSCRIPT";
      throw error;
    }

    return { text, model: turn.model || model || "agy-subprocess" };
  } finally {
    removeDirQuietly(tmpDir);
  }
}

async function transcribeGatewaySttOnce({
  backendModel,
  prepared,
  auth,
  language,
  keyterms,
  mode,
  fetchImpl,
  op,
  getProjectId,
}) {
  const projectId = await getProjectId({
    accessToken: auth.accessToken,
    accountKey: auth.accountKey,
    fetchImpl,
    op,
  });
  return transcribeAudioViaGateway({
    accessToken: auth.accessToken,
    accountKey: auth.accountKey,
    projectId,
    model: backendModel,
    audioBase64: prepared.buffer.toString("base64"),
    mimeType: prepared.mimeType,
    language,
    keyterms,
    mode,
    fetchImpl,
    op,
  });
}

async function transcribeWithAntigravity({
  audioBuffer,
  model,
  contentType = "audio/webm",
  language,
  keyterms,
  command,
  ffmpegPath,
  tmpRoot = os.tmpdir(),
  runTurn = runAgyTurn,
  fetchImpl = fetch,
  transcriptionMode,
  useLegacyAgent = false,
  getAccessToken = getAntigravityAccessToken,
  getProjectId = getAntigravityProjectId,
  op,
  antigravityPrefs,
  hadSpeech = true,
  audioDurationSec,
}) {
  // Callers that don't manage their own request budget (e.g. one-shot file
  // uploads) would otherwise leave ffmpeg conversion, auth, and gateway
  // calls unbounded — a stuck ffmpeg process used to hang these requests
  // indefinitely. Give every call a budget so every downstream stage
  // (conversion, auth, generation, subprocess fallback) is bounded.
  const ownedOp =
    op ||
    createAntigravityOperation({
      budgetMs: computeSttBudgetMs({ audioDurationSec }),
      label: "antigravity-stt",
    });
  op = ownedOp;
  const startedAt = Date.now();
  const resolvedModel = isAntigravityTranscribeModel(model)
    ? model
    : DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL;
  const mode = transcriptionMode || "SMART";
  const legacyArgs = {
    audioBuffer,
    model: undefined,
    contentType,
    language,
    keyterms,
    command,
    ffmpegPath,
    tmpRoot,
    runTurn,
    op,
  };

  const logStage = (stage, extra = {}) => {
    debugLogger.info(
      "Antigravity STT stage",
      { stage, elapsedMs: Date.now() - startedAt, ...extra },
      "transcription"
    );
  };

  if (useLegacyAgent) {
    logStage("agy-legacy-direct");
    const result = await transcribeWithAntigravityLegacyAgent(legacyArgs);
    logStage("agy-legacy-done", { transport: "agy-write-file" });
    return result;
  }

  // This path is only reached for the live model when the live preview
  // stream failed to commit a clean transcript (empty or truncated flush) —
  // the caller only skips straight to processTranscription when the preview
  // already returned non-empty streamed text. Never lose the recording:
  // fall back to the same batch STT gateway path used for the non-live
  // model, and log that the fallback happened.
  const fellBackFromLive = resolvedModel === "gemini-3.5-transcribe-live";
  if (fellBackFromLive) {
    logStage("live-fallback-to-batch", {
      reason: "live preview stream did not commit a transcript",
    });
  }

  const prefs = buildAntigravitySttPrefs(model, antigravityPrefs);
  const resolved = resolveAntigravityModels(getCatalog(), prefs);
  const { notices } = resolved;
  const sttCandidates =
    resolved.candidates.stt?.length > 0 ? resolved.candidates.stt : [resolved.stt].filter(Boolean);
  if (sttCandidates.length === 0) {
    throw emptyCandidatesError(resolved, "stt");
  }
  if (notices.length) {
    logStage("model-notices", { notices: notices.map((n) => `${n.slot}:${n.code}:${n.model}`) });
  }

  op?.throwIfDone?.();
  const prepared = await prepareAudioBuffer({
    audioBuffer,
    contentType,
    ffmpegPath,
    tmpRoot,
    op,
  });

  let auth = await getAccessToken({ signal: op?.signal });
  let authRetried = false;
  let lastError = null;

  for (let index = 0; index < sttCandidates.length; index += 1) {
    const backendModel = sttCandidates[index];
    op?.throwIfDone?.();
    try {
      logStage("gateway-request", {
        bytes: prepared.buffer.length,
        mimeType: prepared.mimeType,
        backendModel,
        candidate: index + 1,
      });
      const gatewayResult = await transcribeGatewaySttOnce({
        backendModel,
        prepared,
        auth,
        language,
        keyterms,
        mode,
        fetchImpl,
        op,
        getProjectId,
      });
      logStage("gateway-done", {
        transport: "daily-stream-multimodal",
        backendModel: gatewayResult.model,
      });
      return {
        text: gatewayResult.text,
        model: gatewayResult.model || resolvedModel,
        notices,
        ...(fellBackFromLive ? { fellBackFromLive: true } : {}),
      };
    } catch (error) {
      lastError = error;
      const decision = decideAntigravityFailover(error, {
        slot: "stt",
        hadSpeech,
        remainingMs: op?.remainingMs?.() ?? 0,
        budgetExhausted: (op?.remainingMs?.() ?? 0) <= 0,
        authRetried,
      });

      if (decision.action === "retry_auth") {
        authRetried = true;
        auth = await getAccessToken({ signal: op?.signal, forceRefresh: true });
        index -= 1;
        continue;
      }

      if (decision.refreshCatalog) notifyModelUnavailable();
      applyFailoverSideEffects(decision, backendModel);

      if (decision.action === "failover") {
        logStage("gateway-failover", { code: error?.code, status: error?.status, backendModel });
        continue;
      }

      if (decision.action === "subprocess") {
        logStage("agy-subprocess-fallback", { code: error?.code });
        const result = await transcribeWithAntigravityLegacyAgent(legacyArgs);
        logStage("agy-legacy-done", { transport: "agy-write-file" });
        return { ...result, notices, ...(fellBackFromLive ? { fellBackFromLive: true } : {}) };
      }

      throw error;
    }
  }

  if (lastError && isNetworkUnreachableError(lastError) && (op?.remainingMs?.() ?? 0) > 8_000) {
    logStage("agy-subprocess-fallback-exhausted", { code: lastError?.code });
    const result = await transcribeWithAntigravityLegacyAgent(legacyArgs);
    return { ...result, notices, ...(fellBackFromLive ? { fellBackFromLive: true } : {}) };
  }

  throw lastError || createAntigravityError("AGY_HTTP", "Antigravity transcription failed");
}

module.exports = {
  buildTranscriptionPrompt,
  TRANSCRIPTION_JSON_SCHEMA,
  transcribeWithAntigravity,
  transcribeWithAntigravityLegacyAgent,
  prepareAudioBuffer,
  parseTranscriptText,
  buildAntigravitySttPrefs,
  computeSttBudgetMs,
};
