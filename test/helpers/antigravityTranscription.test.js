const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { _setUserDataDirForTests } = require("../../src/helpers/antigravityGateway");
const { _resetCatalogForTests } = require("../../src/helpers/antigravityModelCatalog");

// Project-id and model-catalog caches persist under userData; keep them in a
// throwaway dir so these tests never read or write the real one.
let userDataDir;
test.before(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-transcription-userdata-"));
  _setUserDataDirForTests(userDataDir);
  _resetCatalogForTests();
});
test.after(() => {
  _setUserDataDirForTests(null);
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const fakeAuth = async () => ({ accessToken: "fake-access", accountKey: "acct-test" });

const {
  buildTranscriptionPrompt,
  transcribeWithAntigravity,
  parseTranscriptText,
  prepareAudioBuffer,
} = require("../../src/helpers/antigravityTranscription");

test("buildTranscriptionPrompt includes the audio path, only-transcript rule, and write path", () => {
  const audioPath = "input.wav";
  const writeFilePath = "/tmp/openwhispr/transcript.txt";
  const prompt = buildTranscriptionPrompt({
    audioPath,
    writeFilePath,
    language: "de",
    keyterms: ["OpenWhispr", "Gizmo"],
  });

  assert.match(prompt, new RegExp(audioPath.replace(".", "\\.")));
  assert.match(prompt, /ONLY the transcript/i);
  assert.match(prompt, /Do not summarize/i);
  assert.match(prompt, new RegExp(writeFilePath.replace(/\//g, "\\/")));
  assert.match(prompt, /Expected spoken language: de/);
  assert.match(prompt, /OpenWhispr, Gizmo/);
});

test("parseTranscriptText unwraps json transcript field", () => {
  assert.equal(parseTranscriptText('{"transcript":"hello"}'), "hello");
});

test("transcribeWithAntigravity uses daily gateway stream path by default", async () => {
  const calls = [];
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    contentType: "audio/wav",
    language: "auto",
    getAccessToken: fakeAuth,
    fetchImpl: async (url) => {
      calls.push(url);
      if (String(url).includes("loadCodeAssist")) {
        return {
          ok: true,
          json: async () => ({ cloudaicompanionProject: "daily-proj" }),
        };
      }
      return {
        ok: true,
        text: async () =>
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken words"}]},"finishReason":"STOP"}]}}\n',
      };
    },
  });

  assert.equal(result.text, "spoken words");
  // No fetched catalog yet: the static fallback's auto STT pick.
  assert.equal(result.model, "gemini-3.8-flash-tiered");
  assert.ok(calls.some((url) => String(url).includes("streamGenerateContent")));
});

test("transcribeWithAntigravity legacy agent path when useLegacyAgent", async () => {
  const calls = [];
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    contentType: "audio/webm",
    language: "auto",
    useLegacyAgent: true,
    runTurn: async (options) => {
      calls.push(options);
      return { text: "legacy words", model: "gemini-3.5-flash-low" };
    },
  });

  assert.equal(result.text, "legacy words");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].writeFilePath);
  assert.deepEqual(calls[0].addDirs, [path.dirname(calls[0].writeFilePath)]);
  assert.deepEqual(calls[0].extraArgs, ["--sandbox"]);
  assert.ok(!calls[0].extraArgs.includes("--effort"));
});

test("prepareAudioBuffer reports spawn errors instead of a blank ffmpeg conversion failed", async () => {
  const { prepareAudioBuffer } = require("../../src/helpers/antigravityTranscription");
  await assert.rejects(
    () =>
      prepareAudioBuffer({
        audioBuffer: Buffer.from("not-audio"),
        contentType: "audio/webm",
        ffmpegPath: path.join(__dirname, "missing-ffmpeg-binary"),
      }),
    (err) => {
      assert.notEqual(err.message, "ffmpeg conversion failed");
      assert.match(String(err.message), /ENOENT|spawn/i);
      return true;
    }
  );
});

test("prepareAudioBuffer kills a stuck ffmpeg and rejects within the timeout instead of hanging", async () => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-fake-ffmpeg-"));
  const pidFile = path.join(binDir, "ffmpeg.pid");
  const fakeFfmpeg = path.join(binDir, "ffmpeg-stub.sh");
  // Stands in for a stuck ffmpeg (e.g. a hung codec probe): writes its own
  // pid so the test can confirm it was actually killed, then sleeps far
  // longer than the injected timeout.
  fs.writeFileSync(fakeFfmpeg, `#!/bin/sh\necho $$ > "${pidFile}"\nsleep 30\n`);
  fs.chmodSync(fakeFfmpeg, 0o755);

  const isAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  // Give the fake ffmpeg's "echo $$ > pidfile" a generous head start over the
  // conversion timeout so a busy CI/test-runner host (many suites' worth of
  // processes competing for scheduling) can't make the shell get killed
  // before it even writes its own pid.
  const ffmpegTimeoutMs = 1_500;

  try {
    const started = Date.now();
    await assert.rejects(
      () =>
        prepareAudioBuffer({
          audioBuffer: Buffer.from("not-really-audio"),
          contentType: "audio/webm",
          ffmpegPath: fakeFfmpeg,
          ffmpegTimeoutMs,
        }),
      (err) => {
        // A conversion that runs out of time is a timeout. Reporting it as
        // AGY_CANCELLED made the pipeline treat it as a user cancel and drop
        // the recording without an error.
        assert.equal(err.code, "AGY_TIMEOUT");
        return true;
      }
    );
    const elapsedMs = Date.now() - started;
    assert.ok(
      elapsedMs < ffmpegTimeoutMs + 5_000,
      `expected a bounded rejection, took ${elapsedMs}ms`
    );

    // Give the killed process a beat to actually exit, then confirm no
    // orphaned ffmpeg is left running.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
    assert.ok(Number.isInteger(pid) && pid > 0, "the fake ffmpeg should have recorded its pid");
    assert.equal(isAlive(pid), false, "the stuck ffmpeg process must be killed, not orphaned");
  } finally {
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("transcribeWithAntigravity creates a default bounded operation when the caller passes none", async () => {
  // Regression for an unbounded ffmpeg wait: callers that don't manage their
  // own request budget (e.g. one-shot file-upload transcription) used to
  // pass no `op`, so prepareAudioBuffer's ffmpeg conversion got no abort
  // signal and could hang forever. transcribeWithAntigravity must now build
  // its own operation (via computeSttBudgetMs) and thread it through.
  const antigravityOperationPath = require.resolve("../../src/helpers/antigravityOperation");
  const transcriptionPath = require.resolve("../../src/helpers/antigravityTranscription");
  delete require.cache[antigravityOperationPath];
  delete require.cache[transcriptionPath];

  const antigravityOperation = require("../../src/helpers/antigravityOperation");
  const originalCreate = antigravityOperation.createAntigravityOperation;
  let created = null;
  antigravityOperation.createAntigravityOperation = (opts) => {
    created = opts;
    return originalCreate(opts);
  };

  try {
    const {
      transcribeWithAntigravity: freshTranscribe,
    } = require("../../src/helpers/antigravityTranscription");
    const result = await freshTranscribe({
      audioBuffer: Buffer.from("fake-audio"),
      contentType: "audio/wav",
      language: "auto",
      getAccessToken: fakeAuth,
      fetchImpl: async (url) => {
        if (String(url).includes("loadCodeAssist")) {
          return { ok: true, json: async () => ({ cloudaicompanionProject: "daily-proj" }) };
        }
        return {
          ok: true,
          text: async () =>
            'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken words"}]},"finishReason":"STOP"}]}}\n',
        };
      },
    });

    assert.ok(created, "a default operation must be created when the caller passes none");
    assert.ok(
      Number.isFinite(created.budgetMs) && created.budgetMs > 0,
      "the default operation must carry a positive, computeSttBudgetMs-derived budget"
    );
    assert.equal(result.text, "spoken words");
  } finally {
    antigravityOperation.createAntigravityOperation = originalCreate;
    delete require.cache[transcriptionPath];
  }
});

test("transcribeWithAntigravity falls back to agy only on network unreachable", async () => {
  let fetchCalls = 0;
  let runOptions = null;
  const networkErr = Object.assign(new TypeError("fetch failed"), { code: "ENOTFOUND" });
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    contentType: "audio/wav",
    getAccessToken: fakeAuth,
    getProjectId: async () => "daily-proj",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw networkErr;
    },
    op: require("../../src/helpers/antigravityOperation").createAntigravityOperation({
      budgetMs: 60_000,
      label: "test",
    }),
    runTurn: async (options) => {
      runOptions = options;
      fs.writeFileSync(options.writeFilePath, "fallback words");
      return { text: "", model: null };
    },
  });

  assert.equal(result.text, "fallback words");
  assert.ok(fetchCalls >= 1);
  assert.equal(runOptions?.model, undefined);
});

test("transcribeWithAntigravity falls back to the batch gateway for the live model instead of throwing", async () => {
  // Regression: this function used to throw AGY_LIVE_REQUIRES_PREVIEW as
  // soon as it saw the live model id, before even touching the gateway.
  // It's only reached with that model id when the live preview stream
  // failed to commit a transcript (empty/truncated flush) -- the caller
  // already skips this whole function when the preview succeeded. Losing
  // the recording in that case is the bug; it must transcribe through the
  // normal batch STT path instead.
  let tokenCalls = 0;
  const calls = [];
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    model: "gemini-3.5-transcribe-live",
    contentType: "audio/wav",
    language: "auto",
    getAccessToken: async () => {
      tokenCalls += 1;
      return fakeAuth();
    },
    fetchImpl: async (url) => {
      calls.push(url);
      if (String(url).includes("loadCodeAssist")) {
        return {
          ok: true,
          json: async () => ({ cloudaicompanionProject: "daily-proj" }),
        };
      }
      return {
        ok: true,
        text: async () =>
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken words"}]},"finishReason":"STOP"}]}}\n',
      };
    },
  });

  assert.equal(result.text, "spoken words");
  assert.equal(result.fellBackFromLive, true);
  assert.ok(tokenCalls >= 1, "the gateway path must run, not bail out before auth");
  assert.ok(calls.some((url) => String(url).includes("streamGenerateContent")));
});

test("prepareAudioBuffer reports the caller's cancel as AGY_CANCELLED and removes the copied recording", async () => {
  const { createAntigravityOperation } = require("../../src/helpers/antigravityOperation");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agy-stt-root-"));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-fake-ffmpeg-"));
  const fakeFfmpeg = path.join(binDir, "ffmpeg-stub.sh");
  fs.writeFileSync(fakeFfmpeg, "#!/bin/sh\nsleep 30\n");
  fs.chmodSync(fakeFfmpeg, 0o755);
  const controller = new AbortController();
  const op = createAntigravityOperation({ budgetMs: 20_000, signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  try {
    await assert.rejects(
      () =>
        prepareAudioBuffer({
          audioBuffer: Buffer.from("not-really-audio"),
          contentType: "audio/webm",
          ffmpegPath: fakeFfmpeg,
          tmpRoot,
          op,
        }),
      (err) => {
        assert.equal(err.code, "AGY_CANCELLED");
        return true;
      }
    );
    assert.deepEqual(fs.readdirSync(tmpRoot), [], "the temp copy of the recording is removed");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
});

test("a stalled first model leaves budget for the next candidate", async () => {
  const models = [];
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    contentType: "audio/wav",
    getAccessToken: fakeAuth,
    getProjectId: async () => "daily-proj",
    fetchImpl: async (_url, init) => {
      const { model } = JSON.parse(init.body);
      models.push(model);
      if (models.length === 1) {
        // Hang until this attempt's stage signal gives up on it.
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
        });
      }
      return {
        ok: true,
        text: async () =>
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"second model"}]},"finishReason":"STOP"}]}}\n',
      };
    },
    op: require("../../src/helpers/antigravityOperation").createAntigravityOperation({
      budgetMs: 6_000,
      label: "test",
    }),
  });

  assert.equal(result.text, "second model");
  assert.equal(models.length, 2);
  assert.notEqual(models[0], models[1]);
});
