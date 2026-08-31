const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const debugLogger = require("./debugLogger");
const { getAntigravityAccessToken, getAntigravityProjectId } = require("./antigravityAuth");
const { transcribeAudioViaGateway } = require("./antigravityGateway");
const {
  DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL,
  isAntigravityTranscribeModel,
} = require("./antigravityTranscriptionPolicy");
const {
  ensureWritableDir,
  runAgyTurn,
} = require("./antigravityCli");

const GEMINI_MIME_TYPES = {
  "audio/mpeg": "audio/mp3",
  "audio/mp4": "audio/aac",
};

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

function convertToWav({ inputPath, outputPath, ffmpegPath }) {
  const result = spawnSync(
    ffmpegPath,
    ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1", outputPath],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(detail || "ffmpeg conversion failed");
  }
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
}) {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "openwhispr-antigravity-stt-"));
  const extension = extensionForContentType(contentType);
  const inputPath = path.join(tmpDir, `input${extension}`);
  const wavPath = path.join(tmpDir, "input.wav");

  ensureWritableDir(tmpDir);
  fs.writeFileSync(inputPath, Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer));

  let readPath = inputPath;
  let mimeType = mimeTypeForGateway(contentType, extension);
  if (ffmpegPath && extension !== ".wav") {
    convertToWav({ inputPath, outputPath: wavPath, ffmpegPath });
    readPath = wavPath;
    mimeType = "audio/wav";
  }

  const buffer = fs.readFileSync(readPath);
  removeDirQuietly(tmpDir);
  return { buffer, mimeType };
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
}) {
  const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "openwhispr-antigravity-stt-legacy-"));
  const extension = extensionForContentType(contentType);
  const inputPath = path.join(tmpDir, `input${extension}`);
  const wavPath = path.join(tmpDir, "input.wav");
  const transcriptPath = path.join(tmpDir, "transcript.txt");

  try {
    ensureWritableDir(tmpDir);
    fs.writeFileSync(inputPath, Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer));

    let audioPath = path.basename(inputPath);
    if (ffmpegPath && extension !== ".wav") {
      convertToWav({ inputPath, outputPath: wavPath, ffmpegPath });
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
      model: model || "gemini-3.5-flash-low",
      addDirs: [tmpDir],
      cwd: tmpDir,
      writeFilePath: transcriptPath,
      command,
      printTimeout: "45s",
      timeoutMs: 60_000,
      extraArgs: ["--sandbox", "--effort", "low"],
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

    return { text, model: turn.model || model };
  } finally {
    removeDirQuietly(tmpDir);
  }
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
}) {
  const startedAt = Date.now();
  const resolvedModel = isAntigravityTranscribeModel(model)
    ? model
    : DEFAULT_ANTIGRAVITY_TRANSCRIBE_MODEL;
  const mode = transcriptionMode || "SMART";
  const legacyArgs = {
    audioBuffer,
    model: "gemini-3.5-flash-low",
    contentType,
    language,
    keyterms,
    command,
    ffmpegPath,
    tmpRoot,
    runTurn,
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

  if (resolvedModel === "gemini-3.5-transcribe-live") {
    const error = new Error(
      "Antigravity live transcription must use the live preview stream during recording."
    );
    error.code = "AGY_LIVE_REQUIRES_PREVIEW";
    throw error;
  }

  const preparedPromise = prepareAudioBuffer({
    audioBuffer,
    contentType,
    ffmpegPath,
    tmpRoot,
  });
  const authPromise = getAccessToken({ fetchImpl });

  try {
    const [{ buffer, mimeType }, accessToken] = await Promise.all([
      preparedPromise,
      authPromise,
    ]);
    logStage("gateway-request", { bytes: buffer.length, mimeType });
    const gatewayResult = await transcribeAudioViaGateway({
      accessToken,
      model: resolvedModel,
      audioBase64: buffer.toString("base64"),
      mimeType,
      language,
      keyterms,
      mode,
      fetchImpl,
    });
    logStage("gateway-done", {
      transport: "daily-stream-multimodal",
      backendModel: gatewayResult.model,
    });
    return { text: gatewayResult.text, model: gatewayResult.model || resolvedModel };
  } catch (error) {
    if (error?.code === "AGY_CANCELLED") {
      throw error;
    }
    logStage("gateway-error-fallback-agy", { code: error?.code, message: error?.message });
    const result = await transcribeWithAntigravityLegacyAgent(legacyArgs);
    logStage("agy-legacy-done", { transport: "agy-write-file" });
    return result;
  }
}

module.exports = {
  buildTranscriptionPrompt,
  TRANSCRIPTION_JSON_SCHEMA,
  transcribeWithAntigravity,
  transcribeWithAntigravityLegacyAgent,
  prepareAudioBuffer,
  parseTranscriptText,
};
