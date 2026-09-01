const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const {
  DEFAULT_ANTIGRAVITY_MODEL,
  resolveAgyCliModel,
  withoutEffortArgs,
} = require("./antigravityModels");
const DEFAULT_ANTIGRAVITY_STT_MODEL = "gemini-3.5-transcribe";

const AGY_HOME_REL = path.join(".gemini", "antigravity-cli");

const AUTH_RE =
  /(?:not\s+authenticated|please\s+authenticate|api[_ ]?key\s+(?:required|missing|invalid)|authentication\s+required|unauthorized|invalid\s+credentials|not\s+logged\s+in|login\s+required|run\s+`?agy\s+auth(?:\s+login)?`?\s+first)/i;
const QUOTA_RE =
  /(?:resource_exhausted|quota|rate[-\s]?limit|too many requests|\b429\b|billing details|g1 credits)/i;
const TIER_RE =
  /(?:ineligible|not available on (?:your|this) tier|upgrade (?:your|to)|tier restriction)/i;

function agyNotFound(candidate) {
  const error = new Error(
    `Antigravity CLI not found or not executable: ${candidate}. Install agy, run agy auth login, or set ANTIGRAVITY_CLI to the full path.`
  );
  error.code = "AGY_NOT_FOUND";
  return error;
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
  const cliModel = model ? resolveAgyCliModel(model) : "";
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

let activeAgyChild = null;

function killActiveAgyTurn() {
  if (!activeAgyChild || activeAgyChild.killed) {
    return false;
  }
  activeAgyChild.kill("SIGTERM");
  return true;
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

function extractLastModelTextFromTranscript(transcriptPath) {
  let raw;
  try {
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
function recoverTranscriptFromDisk({ cwd, homedir = os.homedir() }) {
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
  const text = extractLastModelTextFromTranscript(transcriptPath);
  return text ? { text, conversationId, transcriptPath } : null;
}

function attachStream(child, streamName, chunks) {
  if (!child[streamName]) {
    return;
  }
  child[streamName].on("data", (chunk) => chunks.push(chunk));
}

function waitForClose(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];
    attachStream(child, "stdout", stdoutChunks);
    attachStream(child, "stderr", stderrChunks);

    let settled = false;
    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGTERM");
            finish({
              timedOut: true,
              exitCode: child.exitCode,
              signal: child.signalCode || "SIGTERM",
              stdout: Buffer.concat(stdoutChunks).toString("utf8"),
              stderr: Buffer.concat(stderrChunks).toString("utf8"),
            });
          }, timeoutMs)
        : null;

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      finish({
        timedOut: false,
        exitCode,
        signal,
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
    const error = new Error(`Antigravity CLI timed out after ${timeoutMs}ms`);
    error.code = "AGY_TIMEOUT";
    throw error;
  }
  const classified = classifyAgyError(`${stderr}\n${stdout}`);
  const error = new Error(classified.message);
  error.code = classified.code;
  error.exitCode = exitCode;
  error.signal = signal;
  throw error;
}

async function runAgyTurn({
  prompt,
  model = DEFAULT_ANTIGRAVITY_MODEL,
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
}) {
  const binary = resolveAgyBinary(command);
  const cliModel = resolveAgyCliModel(model);
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
  env.ANTIGRAVITY_MODEL = cliModel;
  if (path.isAbsolute(binary)) {
    const pathSep = process.platform === "win32" ? ";" : ":";
    env.PATH = path.dirname(binary) + pathSep + (env.PATH || "");
  }

  const child = spawnImpl(binary, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeAgyChild = child;
  child.on("close", () => {
    if (activeAgyChild === child) {
      activeAgyChild = null;
    }
  });
  let result;
  try {
    result = await waitForClose(child, timeoutMs);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw agyNotFound(binary);
    }
    throw error;
  }
  const stdoutText = result.stdout.trim();
  const stderrText = result.stderr.trim();

  if ((result.exitCode ?? 0) !== 0 || result.timedOut) {
    if (result.signal === "SIGTERM") {
      const error = new Error("Antigravity transcription cancelled");
      error.code = "AGY_CANCELLED";
      throw error;
    }
    throwAgyFailure({ ...result, timeoutMs });
  }

  // Prefer the write-file deliverable when requested: print-mode stdout often
  // includes agent tool chatter (especially if cwd is a large workspace).
  const writeFileText = readTextFileIfPresent(writeFilePath);
  if (writeFileText) {
    return { text: writeFileText, model: cliModel, recoveredFrom: "write_file" };
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
          return { text: structured, model: cliModel, recoveredFrom: null, envelope };
        }
        if (typeof envelope?.response === "string" && envelope.response.trim()) {
          return { text: envelope.response.trim(), model: cliModel, recoveredFrom: null, envelope };
        }
      } catch {
        // fall through to raw stdout
      }
    }
    return { text: stdoutText, model: cliModel, recoveredFrom: null };
  }

  const recovered = recoverTranscriptFromDisk({ cwd });
  if (recovered?.text) {
    return { text: recovered.text, model: cliModel, recoveredFrom: "disk_transcript" };
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
  killActiveAgyTurn,
  ensureWritableDir,
  resolveAgyCliModel,
};
