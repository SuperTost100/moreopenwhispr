const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createAntigravityLiveStream,
  MIN_CHUNK_BYTES,
} = require("../../src/helpers/antigravityLiveTranscription");

test("createAntigravityLiveStream emits partial updates and final text", async () => {
  const partials = [];
  let calls = 0;
  const stream = createAntigravityLiveStream({
    language: "en",
    minChunkBytes: MIN_CHUNK_BYTES,
    transcribeFn: async ({ pcmBuffer }) => {
      calls += 1;
      return `spoken-${pcmBuffer.length}`;
    },
    onUpdate: (text) => partials.push(text),
  });

  stream.sendPcm16(Buffer.alloc(MIN_CHUNK_BYTES, 1));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const final = await stream.finish();

  assert.ok(calls >= 1);
  assert.equal(final.text, `spoken-${MIN_CHUNK_BYTES}`);
  assert.equal(final.final, true);
  assert.ok(partials.length >= 1);
  assert.equal(partials[partials.length - 1], `spoken-${MIN_CHUNK_BYTES}`);
});

test("createAntigravityLiveStream finish returns truncated when empty", async () => {
  const stream = createAntigravityLiveStream({
    language: "en",
    transcribeFn: async () => "unused",
  });
  const result = await stream.finish();
  assert.equal(result.text, "");
  assert.equal(result.final, false);
});

test("createAntigravityLiveStream finish returns final true when full clip succeeds", async () => {
  const stream = createAntigravityLiveStream({
    language: "en",
    minChunkBytes: MIN_CHUNK_BYTES,
    transcribeFn: async ({ stageMs }) => {
      if (stageMs) return "partial";
      return "final transcript";
    },
  });
  stream.sendPcm16(Buffer.alloc(MIN_CHUNK_BYTES, 1));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await stream.finish();
  assert.equal(result.text, "final transcript");
  assert.equal(result.final, true);
});

test("createAntigravityLiveStream finish returns final false when full clip fails", async () => {
  let calls = 0;
  const stream = createAntigravityLiveStream({
    language: "en",
    minChunkBytes: MIN_CHUNK_BYTES,
    transcribeFn: async ({ stageMs }) => {
      calls += 1;
      if (stageMs) return "preview";
      throw new Error("gateway down");
    },
    onUpdate: () => {},
  });
  stream.sendPcm16(Buffer.alloc(MIN_CHUNK_BYTES, 1));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const result = await stream.finish();
  assert.ok(calls >= 2);
  assert.equal(result.final, false);
  assert.equal(result.text, "preview");
});

test("createAntigravityLiveStream cancel preview at finish", async () => {
  let previewStarted = false;
  const stream = createAntigravityLiveStream({
    language: "en",
    minChunkBytes: MIN_CHUNK_BYTES,
    transcribeFn: async ({ stageMs }) => {
      if (stageMs) {
        previewStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "late preview";
      }
      return "final";
    },
  });
  stream.sendPcm16(Buffer.alloc(MIN_CHUNK_BYTES, 1));
  await new Promise((resolve) => setTimeout(resolve, 350));
  await stream.finish();
  assert.equal(previewStarted, true);
});

test("createAntigravityLiveStream abort stops further work", async () => {
  let calls = 0;
  const stream = createAntigravityLiveStream({
    language: "en",
    transcribeFn: async () => {
      calls += 1;
      return "nope";
    },
  });
  stream.abort();
  await stream.finish();
  assert.equal(calls, 0);
});
