const test = require("node:test");
const assert = require("node:assert/strict");
const modelRegistryData = require("../../src/models/modelRegistryData.json");
const { resolveAgyCliModel, RETIRED_AGY_CLI_MODELS } = require("../../src/helpers/antigravityModels.cjs");

// M03: gemini-3.5-flash-low/medium/high were retired (agy no longer lists
// them) but stayed as picker rows, a second set of labels for the same
// gemini-3.7 models that resolveAgyCliModel immediately replaces. Remove the
// rows; keep the alias mapping so a previously saved 3.5 id still resolves
// to something the gateway actually serves, instead of showing a blank
// picker.
test("retired gemini-3.5-flash rows are gone from the antigravity picker", () => {
  const antigravity = modelRegistryData.cloudProviders.find((p) => p.id === "antigravity");
  const ids = antigravity.models.map((m) => m.id);

  for (const retired of Object.keys(RETIRED_AGY_CLI_MODELS)) {
    assert.ok(!ids.includes(retired), `${retired} should no longer be a picker row`);
  }

  // No picker row's id gets rewritten by resolveAgyCliModel: every row in
  // the list is a live id, not a second label for another row.
  for (const id of ids) {
    assert.equal(resolveAgyCliModel(id), id, `${id} should not be remapped by resolveAgyCliModel`);
  }
});

test("a saved retired gemini-3.5-flash id still resolves to a served model", () => {
  assert.equal(resolveAgyCliModel("gemini-3.5-flash-low"), "gemini-3.7-flash-low");
  assert.equal(resolveAgyCliModel("gemini-3.5-flash-medium"), "gemini-3.7-flash-medium");
  assert.equal(resolveAgyCliModel("gemini-3.5-flash-high"), "gemini-3.7-flash-high");

  const antigravity = modelRegistryData.cloudProviders.find((p) => p.id === "antigravity");
  const ids = new Set(antigravity.models.map((m) => m.id));
  for (const replacement of Object.values(RETIRED_AGY_CLI_MODELS)) {
    assert.ok(ids.has(replacement), `replacement ${replacement} should still be a picker row`);
  }
});

// M09: the live catalog now lists gemini-3.8-flash-* first. The registry
// must carry those rows so the picker (and a saved explicit pick) can use
// them, and only the newest row should claim to be "the latest".
test("the antigravity picker has gemini-3.8-flash rows and only one claims latest", () => {
  const antigravity = modelRegistryData.cloudProviders.find((p) => p.id === "antigravity");
  const ids = antigravity.models.map((m) => m.id);
  assert.ok(ids.includes("gemini-3.8-flash-low"));
  assert.ok(ids.includes("gemini-3.8-flash-medium"));
  assert.ok(ids.includes("gemini-3.8-flash-high"));

  const latestClaims = antigravity.models.filter((m) => /latest/i.test(m.description));
  assert.deepEqual(
    latestClaims.map((m) => m.id),
    ["gemini-3.8-flash-high"]
  );
});
