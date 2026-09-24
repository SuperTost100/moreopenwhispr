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
          'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken words"}]}}]}}\n',
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

test("transcribeWithAntigravity falls back to agy only when gateway fails", async () => {
  let fetchCalls = 0;
  const result = await transcribeWithAntigravity({
    audioBuffer: Buffer.from("fake-audio"),
    contentType: "audio/wav",
    getAccessToken: fakeAuth,
    fetchImpl: async (url) => {
      fetchCalls += 1;
      if (String(url).includes("loadCodeAssist")) {
        return {
          ok: true,
          json: async () => ({ cloudaicompanionProject: "daily-proj" }),
        };
      }
      return {
        ok: false,
        status: 500,
        text: async () => '{"error":{"message":"upstream"}}',
      };
    },
    runTurn: async (options) => {
      fs.writeFileSync(options.writeFilePath, "fallback words");
      return { text: "", model: "gemini-3.5-flash-low" };
    },
  });

  assert.equal(result.text, "fallback words");
  assert.ok(fetchCalls >= 1);
});
