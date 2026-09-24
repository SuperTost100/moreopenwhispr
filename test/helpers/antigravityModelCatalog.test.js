const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  PINNED_FALLBACK_MODEL,
  STATIC_FALLBACK_CATALOG,
  validateCatalog,
  getCatalog,
  refreshCatalog,
  resolveAntigravityModels,
  listSelectableModels,
  _resetCatalogForTests,
} = require("../../src/helpers/antigravityModelCatalog");
const { _setUserDataDirForTests } = require("../../src/helpers/antigravityGateway");

const NOW = Date.parse("2026-09-24T12:00:00Z");
const AUDIO = { "audio/wav": true, "audio/mp3": true };

// Shaped like a real fetchAvailableModels response.
function fixture() {
  return {
    models: {
      "gemini-3.8-flash-tiered": {
        displayName: "Gemini 3.8 Flash",
        supportsImages: true,
        supportsThinking: true,
        supportedMimeTypes: { ...AUDIO, "image/png": true },
        quotaInfo: { remainingFraction: 0.8, resetTime: "2026-09-25T00:00:00Z" },
        recommended: true,
        tagTitle: "New",
      },
      "gemini-3.5-flash-lite": {
        displayName: "Gemini 3.5 Flash Lite",
        supportsImages: true,
        supportsThinking: true,
        supportedMimeTypes: AUDIO,
        quotaInfo: { remainingFraction: 1, resetTime: "2026-09-25T00:00:00Z" },
      },
      "gemini-3.1-flash-lite": {
        displayName: "Gemini 3.1 Flash Lite",
        supportsImages: false,
        supportedMimeTypes: { "text/plain": true },
        quotaInfo: { remainingFraction: 1 },
      },
      "gemini-2.5-flash-lite": {
        displayName: "Gemini 2.5 Flash Lite",
        supportedMimeTypes: AUDIO,
        quotaInfo: { remainingFraction: 1 },
      },
      "gemini-3.9-pro": {
        displayName: "Gemini 3.9 Pro",
        supportedMimeTypes: AUDIO,
        quotaInfo: { remainingFraction: 1 },
      },
    },
    tieredModelIds: {
      flashLite: ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
      flash: ["gemini-3.8-flash-tiered"],
      pro: ["gemini-3.9-pro"],
    },
    deprecatedModelIds: {
      "gemini-3.6-flash-low": { newModelId: "gemini-3.8-flash-tiered" },
      "gemini-3.7-flash": { newModelId: "gemini-3.6-flash-low" },
      "loop-a": { newModelId: "loop-b" },
      "loop-b": { newModelId: "loop-a" },
    },
    defaultAgentModelId: "gemini-3.8-flash-tiered",
    commandModelIds: ["gemini-3.5-flash-lite"],
  };
}

const catalog = () => validateCatalog(fixture());
const noCooldowns = new Map();

test("validateCatalog accepts the real response shape and rejects malformed ones", () => {
  const valid = catalog();
  assert.ok(valid);
  assert.deepEqual(valid.tieredModelIds.flash, ["gemini-3.8-flash-tiered"]);
  assert.equal(valid.models["gemini-3.8-flash-tiered"].tagTitle, "New");
  assert.equal(validateCatalog(null), null);
  assert.equal(validateCatalog({ models: [] }), null);
  assert.equal(validateCatalog({ models: {} }), null);
  assert.equal(validateCatalog({ models: { x: "not-an-object" } }), null);
});

test("auto policy follows server tiers per slot with the pinned model last", () => {
  const resolved = resolveAntigravityModels(catalog(), {}, NOW, noCooldowns);
  // stt: flash -> flashLite (audio-capable only) -> pinned
  assert.deepEqual(resolved.candidates.stt, [
    "gemini-3.8-flash-tiered",
    "gemini-3.5-flash-lite",
    PINNED_FALLBACK_MODEL,
  ]);
  // cleanup: flashLite -> flash -> pinned; text-only lite models are fine here
  assert.deepEqual(resolved.candidates.cleanup, [
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash-tiered",
    PINNED_FALLBACK_MODEL,
  ]);
  // chat: flash -> pinned
  assert.deepEqual(resolved.candidates.chat, ["gemini-3.8-flash-tiered", PINNED_FALLBACK_MODEL]);
  assert.equal(resolved.stt, "gemini-3.8-flash-tiered");
  assert.equal(resolved.cleanup, "gemini-3.1-flash-lite");
  assert.deepEqual(resolved.notices, []);
});

test("stt never picks a model without an audio MIME type", () => {
  const resolved = resolveAntigravityModels(
    catalog(),
    { stt: "gemini-3.1-flash-lite" },
    NOW,
    noCooldowns
  );
  assert.ok(!resolved.candidates.stt.includes("gemini-3.1-flash-lite"));
  assert.ok(resolved.notices.some((n) => n.code === "EXPLICIT_NOT_CAPABLE" && n.slot === "stt"));
});

test("an explicit capable pick leads its slot", () => {
  const resolved = resolveAntigravityModels(
    catalog(),
    { chat: "gemini-3.9-pro" },
    NOW,
    noCooldowns
  );
  assert.equal(resolved.chat, "gemini-3.9-pro");
});

test("deprecated explicit picks map through the chain; a cycle is kept with a notice", () => {
  const mapped = resolveAntigravityModels(
    catalog(),
    { chat: "gemini-3.7-flash" },
    NOW,
    noCooldowns
  );
  assert.equal(mapped.chat, "gemini-3.8-flash-tiered");
  assert.ok(
    mapped.notices.some(
      (n) => n.code === "DEPRECATED_MAPPED" && n.replacement === "gemini-3.8-flash-tiered"
    )
  );

  const cyclic = resolveAntigravityModels(catalog(), { chat: "loop-a" }, NOW, noCooldowns);
  assert.ok(cyclic.notices.some((n) => n.code === "DEPRECATION_CYCLE"));
  // loop-a is not in the catalog, so auto leads and loop-a stays as last resort
  assert.equal(cyclic.chat, "gemini-3.8-flash-tiered");
  assert.equal(cyclic.candidates.chat.at(-1), "loop-a");
});

test("quota-exhausted and cooling models are skipped until they reset", () => {
  const exhausted = fixture();
  exhausted.models["gemini-3.8-flash-tiered"].quotaInfo = {
    remainingFraction: 0,
    resetTime: "2026-09-24T18:00:00Z",
  };
  const skipped = resolveAntigravityModels(validateCatalog(exhausted), {}, NOW, noCooldowns);
  assert.equal(skipped.stt, "gemini-3.5-flash-lite");

  const afterReset = resolveAntigravityModels(
    validateCatalog(exhausted),
    {},
    Date.parse("2026-09-24T19:00:00Z"),
    noCooldowns
  );
  assert.equal(afterReset.stt, "gemini-3.8-flash-tiered");

  const cooling = new Map([["gemini-3.8-flash-tiered", NOW + 60_000]]);
  assert.equal(resolveAntigravityModels(catalog(), {}, NOW, cooling).stt, "gemini-3.5-flash-lite");
  assert.equal(
    resolveAntigravityModels(catalog(), {}, NOW + 120_000, cooling).stt,
    "gemini-3.8-flash-tiered"
  );
});

test("an explicit pick missing from the catalog falls back to auto, stays last, and adds a notice", () => {
  const resolved = resolveAntigravityModels(
    catalog(),
    { stt: "gemini-9-imaginary" },
    NOW,
    noCooldowns
  );
  assert.equal(resolved.stt, "gemini-3.8-flash-tiered");
  assert.equal(resolved.candidates.stt.at(-1), "gemini-9-imaginary");
  assert.ok(resolved.notices.some((n) => n.code === "EXPLICIT_NOT_IN_CATALOG" && n.slot === "stt"));
});

test("synthetic transcription-mode ids are modes, never explicit catalog picks", () => {
  for (const mode of ["gemini-3.5-transcribe", "gemini-3.5-transcribe-live"]) {
    const resolved = resolveAntigravityModels(catalog(), { stt: mode }, NOW, noCooldowns);
    assert.equal(resolved.stt, "gemini-3.8-flash-tiered");
    assert.ok(!resolved.candidates.stt.includes(mode));
    assert.deepEqual(resolved.notices, []);
  }
});

test("the static fallback catalog resolves every slot", () => {
  const resolved = resolveAntigravityModels(STATIC_FALLBACK_CATALOG, {}, NOW, noCooldowns);
  assert.ok(resolved.stt && resolved.cleanup && resolved.chat);
  assert.ok(resolved.candidates.stt.includes(PINNED_FALLBACK_MODEL));
});

test("listSelectableModels flags audio/image support and hides deprecated ids", () => {
  const withDeprecated = fixture();
  withDeprecated.models["gemini-3.6-flash-low"] = { displayName: "Old", supportedMimeTypes: AUDIO };
  const list = listSelectableModels(validateCatalog(withDeprecated));
  const byId = Object.fromEntries(list.map((m) => [m.id, m]));
  assert.equal(byId["gemini-3.6-flash-low"], undefined);
  assert.deepEqual(byId["gemini-3.8-flash-tiered"], {
    id: "gemini-3.8-flash-tiered",
    displayName: "Gemini 3.8 Flash",
    tag: "New",
    supportsAudio: true,
    supportsImages: true,
  });
  assert.equal(byId["gemini-3.1-flash-lite"].supportsAudio, false);
});

test("refreshCatalog fetches, persists, and keeps the last good catalog on a malformed response", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-catalog-"));
  _setUserDataDirForTests(dir);
  _resetCatalogForTests();
  t.after(() => {
    _setUserDataDirForTests(null);
    _resetCatalogForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(getCatalog().source, "static");

  let body = fixture();
  const requests = [];
  const deps = {
    getAccessToken: async () => ({ accessToken: "fake-access", accountKey: "acct" }),
    getProjectId: async () => "proj-1",
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    },
  };

  const fresh = await refreshCatalog({ reason: "test", ...deps });
  assert.equal(fresh.source, "remote");
  assert.match(requests[0].url, /daily-cloudcode-pa.*fetchAvailableModels$/);
  assert.deepEqual(requests[0].body, { project: "proj-1" });
  assert.ok(fs.existsSync(path.join(dir, "antigravity-model-catalog.json")));

  body = { unexpected: true };
  await assert.rejects(
    refreshCatalog({ reason: "test", ...deps }),
    (e) => e.code === "AGY_CATALOG_INVALID"
  );
  assert.equal(getCatalog().source, "remote", "last good catalog is kept");

  // A new process (fresh memory) picks up the persisted copy.
  _resetCatalogForTests();
  assert.equal(getCatalog().source, "persisted");
  assert.deepEqual(getCatalog().tieredModelIds.flash, ["gemini-3.8-flash-tiered"]);
});
