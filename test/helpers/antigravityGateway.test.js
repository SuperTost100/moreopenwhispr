const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateContent,
  transcribeAudioViaGateway,
  extractResponseText,
  parseStreamGenerateContentSse,
  resolveBackendModel,
  DAILY_CLOUDCODE_BASE,
  STT_BACKEND_MODEL,
} = require("../../src/helpers/antigravityGateway");

test("extractResponseText reads candidate parts", () => {
  const text = extractResponseText({
    response: {
      candidates: [{ content: { parts: [{ text: "hello world" }] } }],
    },
  });
  assert.equal(text, "hello world");
});

test("resolveBackendModel maps retired flash-low CLI ids onto the daily STT model", () => {
  assert.equal(resolveBackendModel("gemini-3.5-flash-low"), STT_BACKEND_MODEL);
  assert.equal(resolveBackendModel("gemini-3.7-flash-low"), STT_BACKEND_MODEL);
  assert.equal(resolveBackendModel("gemini-3.5-transcribe"), "gemini-3.5-transcribe");
  assert.equal(resolveBackendModel("gemini-3.7-flash-medium"), "gemini-3.7-flash-medium");
});

test("parseStreamGenerateContentSse joins streamed text chunks", () => {
  const raw = [
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}}',
    'data: {"response":{"candidates":[{"content":{"parts":[{"text":" world"}]}}]}}',
  ].join("\n");
  assert.equal(parseStreamGenerateContentSse(raw), "Hello world");
});

test("generateContent tries daily before prod", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (String(url).includes("loadCodeAssist")) {
      return {
        ok: true,
        json: async () => ({ cloudaicompanionProject: "daily-proj" }),
      };
    }
    if (String(url).includes("daily-cloudcode")) {
      return {
        ok: true,
        json: async () => ({
          response: { candidates: [{ content: { parts: [{ text: "done" }] } }] },
        }),
      };
    }
    return {
      ok: false,
      status: 429,
      json: async () => ({
        error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" },
      }),
    };
  };

  const result = await generateContent({
    accessToken: "tok",
    projectId: "proj-1",
    model: "gemini-3.5-flash-low",
    request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    fetchImpl,
    retryDelaysMs: [],
  });

  assert.equal(result.text, "done");
  assert.match(calls.find((url) => url.includes("generateContent")), /daily-cloudcode/);
});

test("transcribeAudioViaGateway uses daily stream multimodal flash-low", async () => {
  let captured;
  const fetchImpl = async (url, init) => {
    if (String(url).includes("loadCodeAssist")) {
      return {
        ok: true,
        json: async () => ({ cloudaicompanionProject: "daily-proj" }),
      };
    }
    captured = { url, body: JSON.parse(init.body) };
    return {
      ok: true,
      text: async () =>
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken"}]}}]}}\n',
    };
  };

  const result = await transcribeAudioViaGateway({
    accessToken: "tok",
    audioBase64: "abc",
    mimeType: "audio/wav",
    language: "de",
    keyterms: ["OpenWhispr"],
    mode: "SMART",
    fetchImpl,
  });

  assert.equal(result.text, "spoken");
  assert.equal(result.model, "gemini-3.6-flash-low");
  assert.match(captured.url, /daily-cloudcode.*streamGenerateContent/);
  assert.equal(captured.body.model, "gemini-3.6-flash-low");
  assert.equal(
    captured.body.request.systemInstruction.parts[0].text.includes("Expected spoken language: de"),
    true
  );
  assert.equal(
    captured.body.request.systemInstruction.parts[0].text.includes("OpenWhispr"),
    true
  );
  assert.deepEqual(captured.body.request.contents[0].parts[0].inlineData, {
    mimeType: "audio/wav",
    data: "abc",
  });
});

test("transcribeAudioViaGateway tries the next daily model after a 404", async () => {
  const models = [];
  const fetchImpl = async (url, init) => {
    if (String(url).includes("loadCodeAssist")) {
      return {
        ok: true,
        json: async () => ({ cloudaicompanionProject: "daily-proj" }),
      };
    }
    const body = JSON.parse(init.body);
    models.push(body.model);
    if (body.model === "gemini-3.6-flash-low") {
      return {
        ok: false,
        status: 404,
        text: async () => '{"error":{"message":"Requested entity was not found."}}',
      };
    }
    return {
      ok: true,
      text: async () =>
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"spoken"}]}}]}}\n',
    };
  };

  const result = await transcribeAudioViaGateway({
    accessToken: "tok",
    audioBase64: "abc",
    mimeType: "audio/wav",
    fetchImpl,
  });
  assert.equal(result.text, "spoken");
  assert.equal(result.model, "gemini-3-flash");
  assert.deepEqual(models[0], "gemini-3.6-flash-low");
  assert.equal(models[1], "gemini-3-flash");
});

test("transcribeAudioViaGateway rejects a retired-model notice as a transcript", async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes("loadCodeAssist")) {
      return {
        ok: true,
        json: async () => ({ cloudaicompanionProject: "daily-proj" }),
      };
    }
    return {
      ok: true,
      text: async () =>
        'data: {"response":{"candidates":[{"content":{"parts":[{"text":"Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash in the latest version of Antigravity."}]}}]}}\n',
    };
  };

  await assert.rejects(
    () =>
      transcribeAudioViaGateway({
        accessToken: "tok",
        audioBase64: "abc",
        mimeType: "audio/wav",
        fetchImpl,
      }),
    (error) => {
      assert.equal(error.code, "AGY_MODEL_RETIRED");
      return true;
    }
  );
});

test("generateContent retries on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).includes("daily-cloudcode") && calls < 3) {
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: { code: 429, message: "Resource has been exhausted", status: "RESOURCE_EXHAUSTED" },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        response: { candidates: [{ content: { parts: [{ text: "after retry" }] } }] },
      }),
    };
  };

  const result = await generateContent({
    accessToken: "tok",
    projectId: "proj",
    model: "gemini-3.5-flash-low",
    request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    fetchImpl,
    retryDelaysMs: [1, 1],
    sleepFn: () => Promise.resolve(),
    base: DAILY_CLOUDCODE_BASE,
  });
  assert.equal(result.text, "after retry");
  assert.ok(calls >= 3);
});

test("generateContent surfaces QUOTA_EXCEEDED with messageKey after retries", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 429,
    json: async () => ({
      error: {
        code: 429,
        message: "Resource has been exhausted (e.g. check quota).",
        status: "RESOURCE_EXHAUSTED",
      },
    }),
  });

  await assert.rejects(
    () =>
      generateContent({
        accessToken: "tok",
        projectId: "proj",
        model: "gemini-3.5-flash-low",
        request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
        fetchImpl,
        retryDelaysMs: [1],
        sleepFn: () => Promise.resolve(),
        base: DAILY_CLOUDCODE_BASE,
      }),
    (error) => {
      assert.equal(error.code, "QUOTA_EXCEEDED");
      assert.equal(
        error.messageKey,
        "hooks.audioRecording.errorDescriptions.antigravityQuotaExceeded"
      );
      return true;
    }
  );
});
