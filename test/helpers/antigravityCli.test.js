const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

const {
  buildAgyArgs,
  classifyAgyError,
  recoverTranscriptFromDisk,
  resolveAgyBinary,
  runAgyTurn,
} = require("../../src/helpers/antigravityCli");

function makeChild({ stdout = "", stderr = "", exitCode = 0, delayMs = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
    return true;
  };
  setImmediate(() => {
    if (delayMs > 0) {
      return;
    }
    if (stdout) {
      child.stdout.emit("data", Buffer.from(stdout));
    }
    if (stderr) {
      child.stderr.emit("data", Buffer.from(stderr));
    }
    child.stdout.emit("end");
    child.stderr.emit("end");
    child.emit("close", exitCode);
  });
  return child;
}

test("buildAgyArgs puts --print immediately before the prompt", () => {
  const args = buildAgyArgs({
    prompt: "hello world",
    model: "gemini-3.5-flash-low",
    addDirs: ["/tmp/audio"],
    outputFormat: "text",
    printTimeout: "60s",
    jsonSchema: { type: "object" },
    conversationId: "abc-123",
    extraArgs: ["--effort", "high"],
  });

  assert.equal(args[0], "--print");
  assert.equal(args[1], "hello world");
  assert.deepEqual(args.slice(2), [
    "--dangerously-skip-permissions",
    "--disable-slash-commands",
    "--model",
    "gemini-3.5-flash-low",
    "--add-dir",
    "/tmp/audio",
    "--output-format",
    "text",
    "--print-timeout",
    "60s",
    "--json-schema",
    '{"type":"object"}',
    "--conversation",
    "abc-123",
    "--effort",
    "high",
  ]);
});

test("classifyAgyError detects auth, quota, and generic failures", () => {
  assert.deepEqual(classifyAgyError("please authenticate with agy auth login first"), {
    code: "AUTH_REQUIRED",
    message: "please authenticate with agy auth login first",
  });
  assert.deepEqual(classifyAgyError("resource_exhausted: quota exceeded"), {
    code: "QUOTA_EXCEEDED",
    message: "resource_exhausted: quota exceeded",
  });
  assert.deepEqual(classifyAgyError("model not available on your tier"), {
    code: "QUOTA_EXCEEDED",
    message: "model not available on your tier",
  });
  assert.deepEqual(classifyAgyError("something else broke"), {
    code: "AGY_ERROR",
    message: "something else broke",
  });
});

test("resolveAgyBinary finds agy in ~/.local/bin when PATH is empty", () => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-home-"));
  const bin = path.join(homedir, ".local", "bin");
  fs.mkdirSync(bin, { recursive: true });
  const agy = path.join(bin, "agy");
  fs.writeFileSync(agy, "#!/bin/sh\n");
  fs.chmodSync(agy, 0o755);
  try {
    assert.equal(resolveAgyBinary("agy", { homedir, env: { PATH: "" } }), agy);
  } finally {
    fs.rmSync(homedir, { recursive: true, force: true });
  }
});

test("resolveAgyBinary throws AGY_NOT_FOUND when the CLI is missing", () => {
  assert.throws(
    () =>
      resolveAgyBinary("agy", {
        homedir: path.join(os.tmpdir(), "no-agy-home"),
        env: { PATH: "" },
      }),
    (error) => error.code === "AGY_NOT_FOUND"
  );
});

test("recoverTranscriptFromDisk reads the latest model line from transcript.jsonl", (t) => {
  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-home-"));
  const cwd = path.join(homedir, "project");
  fs.mkdirSync(cwd, { recursive: true });

  const agyRoot = path.join(homedir, ".gemini", "antigravity-cli");
  const conversationId = "conv-1";
  fs.mkdirSync(path.join(agyRoot, "cache"), { recursive: true });
  fs.writeFileSync(
    path.join(agyRoot, "cache", "last_conversations.json"),
    JSON.stringify({ [cwd]: conversationId })
  );

  const transcriptDir = path.join(agyRoot, "brain", conversationId, ".system_generated", "logs");
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, "transcript.jsonl"),
    [
      JSON.stringify({ source: "SYSTEM", type: "CONVERSATION_HISTORY", content: "ignored" }),
      JSON.stringify({ source: "MODEL", type: "PLANNER_RESPONSE", content: "first" }),
      JSON.stringify({ source: "MODEL", type: "FINAL", content: "final transcript" }),
    ].join("\n")
  );

  t.after(() => fs.rmSync(homedir, { recursive: true, force: true }));

  const recovered = recoverTranscriptFromDisk({ cwd, homedir });
  assert.deepEqual(recovered, {
    text: "final transcript",
    conversationId,
    transcriptPath: path.join(transcriptDir, "transcript.jsonl"),
  });
});

test("runAgyTurn returns stdout on success", async () => {
  const result = await runAgyTurn({
    prompt: "hello",
    model: "gemini-3.5-flash-low",
    command: process.execPath,
    spawnImpl: (_command, args, options) => {
      assert.equal(args[0], "--print");
      assert.equal(args[1], "hello");
      assert.equal(options.env.ANTIGRAVITY_MODEL, "gemini-3.5-flash-low");
      return makeChild({ stdout: "ok\n" });
    },
  });

  assert.deepEqual(result, { text: "ok", model: "gemini-3.5-flash-low", recoveredFrom: null });
});

test("runAgyTurn prefers writeFilePath over noisy stdout", async (t) => {
  const writeFilePath = path.join(os.tmpdir(), `agy-write-prefer-${Date.now()}.txt`);
  fs.writeFileSync(writeFilePath, "clean transcript");
  t.after(() => fs.rmSync(writeFilePath, { force: true }));

  const result = await runAgyTurn({
    prompt: "transcribe",
    command: process.execPath,
    spawnImpl: () => makeChild({ stdout: "I will now explore the workspace...\n" }),
    writeFilePath,
  });

  assert.equal(result.text, "clean transcript");
  assert.equal(result.recoveredFrom, "write_file");
});

test("runAgyTurn falls back to writeFilePath when stdout is empty", async (t) => {
  const writeFilePath = path.join(os.tmpdir(), `agy-write-${Date.now()}.txt`);
  fs.writeFileSync(writeFilePath, "from disk");
  t.after(() => fs.rmSync(writeFilePath, { force: true }));

  const result = await runAgyTurn({
    prompt: "transcribe",
    command: process.execPath,
    spawnImpl: () => makeChild({ stdout: "" }),
    writeFilePath,
  });

  assert.equal(result.text, "from disk");
  assert.equal(result.recoveredFrom, "write_file");
});

test("runAgyTurn throws AUTH_REQUIRED on non-zero auth exit", async () => {
  await assert.rejects(
    runAgyTurn({
      prompt: "hello",
      command: process.execPath,
      spawnImpl: () => makeChild({ stderr: "please authenticate\n", exitCode: 1 }),
    }),
    (error) => error.code === "AUTH_REQUIRED"
  );
});
