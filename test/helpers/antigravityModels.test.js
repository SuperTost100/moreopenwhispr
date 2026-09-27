"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// antigravityModels ships twice: .cjs for Electron main (which can only
// require CJS) and .ts for the renderer (Vite's SSR runner evaluates every
// source file, .cjs included, as ESM). A drift between them means main and
// renderer disagree about which agy model id is current.
test("the .ts mirror matches antigravityModels.cjs", async () => {
  const ts = await import("../../src/helpers/antigravityModels.ts");
  const cjs = require("../../src/helpers/antigravityModels.cjs");

  for (const name of Object.keys(cjs)) {
    assert.ok(name in ts, `antigravityModels.ts is missing ${name}`);
  }

  assert.equal(ts.DEFAULT_ANTIGRAVITY_MODEL, cjs.DEFAULT_ANTIGRAVITY_MODEL);
  assert.deepEqual(ts.RETIRED_AGY_CLI_MODELS, cjs.RETIRED_AGY_CLI_MODELS);

  const models = [
    "",
    "  ",
    "gemini-3.5-flash-low",
    "gemini-3.7-flash-low",
    "gemini-3.5-transcribe",
  ];
  for (const model of models) {
    assert.equal(
      ts.resolveAgyCliModel(model),
      cjs.resolveAgyCliModel(model),
      `resolveAgyCliModel disagreed on ${JSON.stringify(model)}`
    );
  }

  assert.deepEqual(
    ts.withoutEffortArgs(["--effort", "low", "--keep"]),
    cjs.withoutEffortArgs(["--effort", "low", "--keep"])
  );
  assert.deepEqual(ts.withoutEffortArgs(), cjs.withoutEffortArgs());

  const autoInputs = ["auto", "Auto", " AUTO ", "gemini-3.7-flash-low", "", "  "];
  for (const model of autoInputs) {
    assert.equal(
      ts.isAutoAntigravityModel(model),
      cjs.isAutoAntigravityModel(model),
      `isAutoAntigravityModel disagreed on ${JSON.stringify(model)}`
    );
  }
});

test("isAutoAntigravityModel only matches the auto sentinel, case- and whitespace-insensitively", () => {
  const { isAutoAntigravityModel } = require("../../src/helpers/antigravityModels.cjs");
  assert.equal(isAutoAntigravityModel("auto"), true);
  assert.equal(isAutoAntigravityModel("Auto"), true);
  assert.equal(isAutoAntigravityModel(" AUTO "), true);
  assert.equal(isAutoAntigravityModel(""), false);
  assert.equal(isAutoAntigravityModel(undefined), false);
  assert.equal(isAutoAntigravityModel("gemini-3.8-flash-low"), false);
  assert.equal(isAutoAntigravityModel("automatically"), false);
});

// resolveAgyCliModel must leave "auto" untouched: settings/onboarding store
// it as the sentinel for "resolve against the live catalog", and reading it
// back must not silently rewrite it to a pinned default.
test("resolveAgyCliModel does not rewrite the auto sentinel", () => {
  const { resolveAgyCliModel } = require("../../src/helpers/antigravityModels.cjs");
  assert.equal(resolveAgyCliModel("auto"), "auto");
});

test("every retired id resolves to a live one", () => {
  const {
    RETIRED_AGY_CLI_MODELS,
    resolveAgyCliModel,
  } = require("../../src/helpers/antigravityModels.cjs");
  for (const [retired, replacement] of Object.entries(RETIRED_AGY_CLI_MODELS)) {
    assert.equal(resolveAgyCliModel(retired), replacement);
    assert.ok(!(replacement in RETIRED_AGY_CLI_MODELS), `${replacement} is itself retired`);
  }
});
