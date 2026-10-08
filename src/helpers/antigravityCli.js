const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  DEFAULT_ANTIGRAVITY_MODEL,
  resolveAgyCliModel,
  isAutoAntigravityModel,
  withoutEffortArgs,
} = require("./antigravityModels.cjs");
const { createAntigravityError } = require("./antigravityOperation");
const DEFAULT_ANTIGRAVITY_STT_MODEL = "gemini-3.5-transcribe";

const AGY_HOME_REL = path.join(".gemini", "antigravity-cli");

const AUTH_RE =
  /(?:not\s+authenticated|please\s+authenticate|api[_ ]?key\s+(?:required|missing|invalid)|authentication\s+required|unauthorized|invalid\s+credentials|not\s+logged\s+in|login\s+required|run\s+`?agy\s+auth(?:\s+login)?`?\s+first)/i;
const QUOTA_RE =
  /(?:resource_exhausted|quota|rate[-\s]?limit|too many requests|\b429\b|billing details|g1 credits)/i;
const TIER_RE =
  /(?:ineligible|not available on (?:your|this) tier|upgrade (?:your|to)|tier restriction)/i;

function agyNotFound(candidate) {
  return createAntigravityError(
    "AGY_NOT_FOUND",
    `Antigravity CLI not found or not executable: ${candidate}. Install agy, run agy auth login, or set ANTIGRAVITY_CLI to the full path.`
  );
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function agyFileName(command) {
  if (process.platform === "win32" && !command.toLowerCase().endsWith(".exe")) {
    return `${command}.exe`;
  }
  return command;
}

function agySearchDirs(homedir) {
  return [
    path.join(homedir, ".local", "bin"),
    path.join(homedir, "bin"),
    path.join(homedir, ".antigravity", "antigravity", "bin"),
    path.join(homedir, ".antigravity-ide", "antigravity-ide", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

// GUI Electron PATH is often /usr/bin:/bin. agy lives in ~/.local/bin or Homebrew.
function resolveAgyBinary(command, { homedir = os.homedir(), env = process.env } = {}) {
  const candidate = command || env.ANTIGRAVITY_CLI || "agy";
  if (path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\")) {
    if (!isExecutableFile(candidate)) throw agyNotFound(candidate);
    return candidate;
  }

  const pathSep = process.platform === "win32" ? ";" : ":";
  const pathDirs = String(env.PATH || "")
    .split(pathSep)
    .filter(Boolean);
  const seen = new Set();
  for (const dir of [...pathDirs, ...agySearchDirs(homedir)]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const full = path.join(dir, agyFileName(candidate));
    if (isExecutableFile(full)) return full;
  }
  throw agyNotFound(candidate);
}

function buildAgyArgs({
  prompt,
  model,
  addDirs = [],
  outputFormat = "text",
  printTimeout,
  jsonSchema,
  conversationId,
  extraArgs = [],
}) {
  const args = ["--print", prompt, "--dangerously-skip-permissions", "--disable-slash-commands"];
  const cliModel = model && !isAutoAntigravityModel(model) ? resolveAgyCliModel(model) : "";
  if (cliModel) {
    args.push("--model", cliModel);
  }
  for (const dir of addDirs) {
    if (dir) {
      args.push("--add-dir", dir);
    }
  }
  if (outputFormat) {
    args.push("--output-format", outputFormat);
  }
  if (printTimeout) {
    args.push("--print-timeout", printTimeout);
  }
  if (jsonSchema) {
    args.push(
      "--json-schema",
      typeof jsonSchema === "string" ? jsonSchema : JSON.stringify(jsonSchema)
    );
  }
  if (conversationId) {
    args.push("--conversation", conversationId);
  }
  const safeExtraArgs = withoutEffortArgs(extraArgs);
  if (safeExtraArgs.length > 0) {
    args.push(...safeExtraArgs);
  }
  return args;
}

function classifyAgyError(stderrOrText) {
  const haystack = String(stderrOrText || "").trim();
  const firstLine = haystack.split(/\r?\n/).find((line) => line.trim()) || "Antigravity CLI failed";
  if (AUTH_RE.test(haystack)) {
    return { code: "AUTH_REQUIRED", message: firstLine };
  }
  if (QUOTA_RE.test(haystack)) {
    return { code: "QUOTA_EXCEEDED", message: firstLine };
  }
  if (TIER_RE.test(haystack)) {
    return { code: "QUOTA_EXCEEDED", message: firstLine };
  }
  return { code: "AGY_ERROR", message: firstLine };
}

const KILL_GRACE_MS = 3_000;

// SIGTERM first so agy can clean up; SIGKILL if it hasn't exited after a
// short grace period, so a wedged child can't outlive the request.
function terminateChild(child, graceMs = KILL_GRACE_MS) {
  if (child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  const escalate = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
  }, graceMs);
  escalate.unref?.();
  child.once?.("close", () => clearTimeout(escalate));
}

function ensureWritableDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveConversationIdForCwd(agyRoot, cwd) {
  const normalized = path.resolve(cwd);
  const lastConversations = readJsonFile(path.join(agyRoot, "cache", "last_conversations.json"));
  if (lastConversations && typeof lastConversations === "object") {
    const direct = lastConversations[normalized];
    if (typeof direct === "string" && direct.trim()) {
      return direct.trim();
    }
    for (const [key, value] of Object.entries(lastConversations)) {
      if (typeof value === "string" && path.resolve(key) === normalized) {
        return value.trim();
      }
    }
  }
  return null;
}

function extractLastModelTextFromTranscript(transcriptPath, notBeforeMs) {
  let raw;
  try {
    // A transcript older than this turn belongs to an earlier conversation
    // in the same cwd; its last answer is not this turn's output.
    if (Number.isFinite(notBeforeMs) && fs.statSync(transcriptPath).mtimeMs < notBeforeMs) {
      return null;
    }
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry?.source !== "MODEL") {
      continue;
    }
    if (entry?.type === "CHECKPOINT" || entry?.type === "CONVERSATION_HISTORY") {
      continue;
    }
    const content = entry?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
  }
  return null;
}

// ponytail: best-effort scrape of agy's on-disk transcript cache when --print stdout is empty (#76).
// Ceiling: only knows last_conversations.json → brain/<id>/transcript.jsonl; schema drift returns null.
function recoverTranscriptFromDisk({ cwd, homedir = os.homedir(), notBeforeMs }) {
  if (!cwd) {
    return null;
  }
  const agyRoot = path.join(homedir, AGY_HOME_REL);
  const conversationId = resolveConversationIdForCwd(agyRoot, cwd);
  if (!conversationId) {
    return null;
  }
  const transcriptPath = path.join(
    agyRoot,
    "brain",
    conversationId,
    ".system_generated",
    "logs",
    "transcript.jsonl"
  );
  const text = extractLastModelTextFromTranscript(transcriptPath, notBeforeMs);
  return text ? { text, conversationId, transcriptPath } : null;
}

function attachStream(child, streamName, chunks) {
  if (!child[streamName]) {
    return;
  }
  child[streamName].on("data", (chunk) => chunks.push(chunk));
}

function waitForClose(child, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    attachStream(child, "stdout", stdoutChunks);
    attachStream(child, "stderr", stderrChunks);

    let settled = false;
    let cancelled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            terminateChild(child);
            finish({
              timedOut: true,
              exitCode: child.exitCode,
              signal: child.signalCode || "SIGTERM",
              stdout: Buffer.concat(stdoutChunks).toString("utf8"),
              stderr: Buffer.concat(stderrChunks).toString("utf8"),
            });
          }, timeoutMs)
        : null;

    // A caller-supplied abort signal kills the child directly (not just stops
    // waiting on it) — otherwise the orphaned agy process keeps running after
    // the caller has already given up on the result.
    const onAbort = () => {
      cancelled = true;
      terminateChild(child);
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      reject(error);
    });

    child.on("close", (exitCode, closeSignal) => {
      finish({
        timedOut: false,
        cancelled,
        exitCode,
        signal: closeSignal,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}

function readTextFileIfPresent(filePath) {
  if (!filePath) {
    return null;
  }
  try {
    const text = fs.readFileSync(filePath, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

function throwAgyFailure({ stdout, stderr, exitCode, signal, timedOut, timeoutMs }) {
  if (timedOut) {
    throw createAntigravityError("AGY_TIMEOUT", `Antigravity CLI timed out after ${timeoutMs}ms`);
  }
  const classified = classifyAgyError(`${stderr}\n${stdout}`);
  throw createAntigravityError(classified.code, classified.message, { exitCode, signal });
}

async function runAgyTurn({
  prompt,
  model,
  addDirs,
  cwd = process.cwd(),
  timeoutMs = 300_000,
  jsonSchema,
  conversationId,
  command,
  writeFilePath,
  env: extraEnv,
  spawnImpl = spawn,
  outputFormat,
  printTimeout,
  extraArgs,
  signal,
}) {
  const binary = resolveAgyBinary(command);
  // Only resolve/remap when a model was actually requested — an omitted
  // model, or our own "auto" sentinel (settings/onboarding default; not a
  // real agy model id), must reach the CLI with no --model flag at all so
  // agy applies its own current default instead of us freezing one in.
  const cliModel = model && !isAutoAntigravityModel(model) ? resolveAgyCliModel(model) : "";
  const args = buildAgyArgs({
    prompt,
    model: cliModel,
    addDirs,
    outputFormat,
    printTimeout,
    jsonSchema,
    conversationId,
    extraArgs,
  });
  const env = { ...process.env, ...extraEnv };
  if (cliModel) env.ANTIGRAVITY_MODEL = cliModel;
  if (path.isAbsolute(binary)) {
    const pathSep = process.platform === "win32" ? ";" : ":";
    env.PATH = path.dirname(binary) + pathSep + (env.PATH || "");
  }

  const startedAtMs = Date.now();
  const child = spawnImpl(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let result;
  try {
    result = await waitForClose(child, timeoutMs, signal);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw agyNotFound(binary);
    }
    throw error;
  }
  const stdoutText = result.stdout.trim();
  const stderrText = result.stderr.trim();

  if ((result.exitCode ?? 0) !== 0 || result.timedOut || result.cancelled) {
    // Check timedOut FIRST: the internal deadline kills the child with the
    // same SIGTERM a caller cancel uses, so signal alone can't tell "this
    // print call ran out of time" from "the caller cancelled it" apart —
    // only the waitForClose-tracked timedOut/cancelled flags can.
    if (result.timedOut) {
      throwAgyFailure({ ...result, timeoutMs });
    }
    if (result.cancelled || result.signal === "SIGTERM" || result.signal === "SIGKILL") {
      throw createAntigravityError("AGY_CANCELLED", "Antigravity transcription cancelled");
    }
    throwAgyFailure({ ...result, timeoutMs });
  }

  // Prefer the write-file deliverable when requested: print-mode stdout often
  // includes agent tool chatter (especially if cwd is a large workspace).
  const writeFileText = readTextFileIfPresent(writeFilePath);
  if (writeFileText) {
    return { text: writeFileText, model: cliModel || null, recoveredFrom: "write_file" };
  }

  if (stdoutText) {
    // JSON/--json-schema mode wraps the model payload in an envelope.
    if (outputFormat === "json") {
      try {
        const envelope = JSON.parse(stdoutText);
        if (envelope?.structured_output != null) {
          const structured =
            typeof envelope.structured_output === "string"
              ? envelope.structured_output
              : JSON.stringify(envelope.structured_output);
          return { text: structured, model: cliModel || null, recoveredFrom: null, envelope };
        }
        if (typeof envelope?.response === "string" && envelope.response.trim()) {
          return {
            text: envelope.response.trim(),
            model: cliModel || null,
            recoveredFrom: null,
            envelope,
          };
        }
      } catch {
        // fall through to raw stdout
      }
    }
    return { text: stdoutText, model: cliModel || null, recoveredFrom: null };
  }

  const recovered = recoverTranscriptFromDisk({ cwd, notBeforeMs: startedAtMs });
  if (recovered?.text) {
    return { text: recovered.text, model: cliModel || null, recoveredFrom: "disk_transcript" };
  }

  throwAgyFailure({
    stdout: stdoutText,
    stderr: stderrText || "Antigravity CLI returned empty output",
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: false,
    timeoutMs,
  });
}

module.exports = {
  DEFAULT_ANTIGRAVITY_MODEL,
  DEFAULT_ANTIGRAVITY_STT_MODEL,
  resolveAgyBinary,
  buildAgyArgs,
  classifyAgyError,
  recoverTranscriptFromDisk,
  runAgyTurn,
  terminateChild,
  ensureWritableDir,
  resolveAgyCliModel,
};
