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
  assert.equal(final.truncated, false);
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
  assert.equal(result.truncated, true);
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
