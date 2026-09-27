M09 follow-up - "auto" sentinel could leak into agy --model

Status: FIXED NOW

Found during review of 1a29f5f3 (the M09/M03 commit). Once settings default
antigravityCli/chatAgentModel/dictationAgentModel/cleanupModel to the string
"auto", any code path that hands that string straight to the agy CLI
subprocess needed to treat it as "no model requested," not a literal model
id.

Root cause
- src/helpers/antigravityCli.js had `const cliModel = model ? resolveAgyCliModel(model) : "";`
  in both buildAgyArgs and runAgyTurn. resolveAgyCliModel("auto") is a
  passthrough (not empty, not in RETIRED_AGY_CLI_MODELS), so cliModel ended
  up as the literal string "auto", and buildAgyArgs pushed `--model auto`
  and set `env.ANTIGRAVITY_MODEL = "auto"`. agy has no model called "auto";
  it is only OpenWhispr's own sentinel for "resolve against the live
  catalog" (resolveAntigravityModels in antigravityModelCatalog.js), which
  is a gateway-path concept the CLI subprocess path never touches.
- This affects the screen-context (image attached) reasoning path and the
  agy CLI tool-loop fallback in src/helpers/antigravityReasoning.js, both of
  which pass `model || DEFAULT_ANTIGRAVITY_MODEL` straight into runAgyTurn.

Fix
- Added `isAutoAntigravityModel(model)` to src/helpers/antigravityModels.ts
  and .cjs (case-insensitive, trims whitespace).
- src/helpers/antigravityCli.js: both `cliModel` computations (buildAgyArgs,
  runAgyTurn) now check `model && !isAutoAntigravityModel(model)` before
  calling resolveAgyCliModel, so "auto" is treated exactly like an omitted
  model - no --model flag, no ANTIGRAVITY_MODEL env var, agy applies its own
  current default.
- resolveAgyCliModel itself is untouched: it still returns "auto" unchanged.
  settingsStore.ts reads chatAgentModel/dictationAgentModel/cleanupModel
  through resolveAgyCliModel precisely so a saved retired 3.5 id migrates
  (M03) - it must keep reading back "auto" as "auto", not silently rewrite
  it to DEFAULT_ANTIGRAVITY_MODEL. Verified via a dedicated test
  (resolveAgyCliModel("auto") === "auto").

Files changed
- src/helpers/antigravityModels.ts
- src/helpers/antigravityModels.cjs
- src/helpers/antigravityCli.js
- test/helpers/antigravityModels.test.js
- test/helpers/antigravityCli.test.js

Tests
- test/helpers/antigravityModels.test.js: ts/cjs parity for
  isAutoAntigravityModel across auto/Auto/" AUTO "/model-id/empty inputs;
  a standalone true/false table; resolveAgyCliModel("auto") === "auto".
- test/helpers/antigravityCli.test.js: "runAgyTurn treats the auto sentinel
  like no model requested" - asserts no --model arg and no
  ANTIGRAVITY_MODEL env var when model: "auto" is passed in.
- Command: `node --test test/helpers/antigravityCli.test.js
  test/helpers/antigravityModels.test.js test/helpers/antigravityRetiredFlashModels.test.js
  test/helpers/antigravityDefaultModel.test.js test/helpers/antigravityReasoning.test.js`
- before.txt / after.txt in this folder: before shows the two new tests
  failing (assertion mismatch + isAutoAntigravityModel not a function on the
  ts mirror), after is a clean run of the full antigravity CLI/models test
  set.
- `npm run typecheck` clean.

Commit: 2acde933 "Stop the antigravity auto sentinel from reaching agy --model"
