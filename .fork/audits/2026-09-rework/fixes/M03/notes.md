M03 - Retired Gemini 3.5 Flash rows still in the picker

Status: FIXED NOW

Reproduced on HEAD (47356a06). `agy models` (read-only) confirms gemini-3.5
is not in the live catalog at all anymore (3.8, 3.7, 3.6, 3.1-pro, claude,
gpt-oss only). The registry still listed gemini-3.5-flash-low/medium/high as
antigravity picker rows, and RETIRED_AGY_CLI_MODELS in
src/helpers/antigravityModels.ts/.cjs immediately remapped every one of them
to the matching 3.7 id before the CLI call - a second, dead set of labels
for the same three models.

Fix
- src/models/modelRegistryData.json: removed the gemini-3.5-flash-low/
  medium/high rows from the antigravity provider's models array.
- Kept RETIRED_AGY_CLI_MODELS (the 3.5 -> 3.7 alias map) in
  src/helpers/antigravityModels.ts/.cjs unchanged, so a previously saved
  3.5 id still resolves to a served model instead of 404ing.
- Verified the migration path: chatAgentModel/dictationAgentModel/
  cleanupModel in src/stores/settingsStore.ts already wrap their persisted
  value in resolveAgyCliModel() at load, so a user who saved
  "gemini-3.5-flash-medium" before this change loads as
  "gemini-3.7-flash-medium" - a live row, not a blank picker selection. The
  CLI subprocess path (src/helpers/antigravityCli.js runAgyTurn) also runs
  resolveAgyCliModel() on whatever model it is given, so scopes without a
  settings-store migration (e.g. noteFormattingModel) are still covered at
  call time.
- Considered 3.7: `agy models` still lists gemini-3.7-flash-* today, so per
  the brief's guidance those rows stay (only added 3.8 on top, see M09).
  Also noticed gemini-3.6-flash-* and gemini-3.1-pro-low now exist in the
  live catalog but are not in the registry - out of scope for this finding,
  not touched.

Files changed
- src/models/modelRegistryData.json (3.5 rows removed; also has the M09 3.8
  rows added in the same edit)
- src/locales/en/translation.json (3.5 description keys removed; see M09
  notes for the accompanying 3.8 keys added in the same file)

Tests
- test/helpers/antigravityRetiredFlashModels.test.js (new):
  - no antigravity picker row id is in RETIRED_AGY_CLI_MODELS
  - no antigravity picker row id gets rewritten by resolveAgyCliModel
    (i.e. no row is a second label for another row)
  - a saved gemini-3.5-flash-* id still resolves to the matching 3.7 id,
    and that 3.7 id is still a live picker row
- Command: `node --test test/helpers/antigravityRetiredFlashModels.test.js
  test/helpers/antigravityModels.test.js test/helpers/antigravityCli.test.js`
- before.txt / after.txt in this folder (shared run with M09, one combined
  fix touches the same files).
- `npm run typecheck` clean.

Note: test/locales/translationCoverage.test.js will fail until L01 lands
(new antigravity_gemini_3_8_flash_* keys need translation in every locale).
That's the next commit.

Commit: 1a29f5f3 "Point antigravity defaults and the picker at the models Antigravity still serves"
