M09 - Gemini 3.7 is still the default

Status: FIXED NOW

Reproduced on HEAD (47356a06). Confirmed with `agy models` (read-only, no tokens
printed): the live catalog now lists gemini-3.8-flash-high/medium/low first,
then 3.7, then 3.6, then 3.1-pro, claude, gpt-oss. Gemini 3.5 is fully gone
from the CLI catalog.

Root cause
- `chatAgentModel` and `dictationAgentModel` in src/stores/settingsStore.ts
  defaulted to the literal `"gemini-3.7-flash-medium"`, and `cleanupModel`
  defaulted to `DEFAULT_ANTIGRAVITY_MODEL` (also 3.7-low at the time).
- Onboarding (src/components/onboarding/antigravitySetup.ts) wrote the same
  literal 3.7 ids for cleanup and chat.
- These are explicit picks. src/helpers/antigravityModelCatalog.js
  resolveAntigravityModels() gives an explicit pick priority over the "auto"
  tier-ordered policy, so a fresh install pinned 3.7 forever, even though the
  live catalog already had 3.8.
- The dedicated Antigravity STT/cleanup picker (AntigravitySettingsPanel.tsx)
  and its settings fields (antigravitySttModel/antigravityCleanupModel/
  antigravityChatModel) already defaulted to "auto" and already worked
  correctly - this bug was specifically in the general chat/dictation-agent/
  cleanup scope defaults, which are shared across all providers and default
  provider is "antigravity".
- The vision model default (dictationAgentVisionModel) was already fixed on
  HEAD: it defaults to "" (never configured) by design, not a pinned id, so
  no change was needed there.

Fix
- src/stores/settingsStore.ts: chatAgentModel, dictationAgentModel,
  cleanupModel now default to `"auto"` instead of a pinned model id.
- src/components/onboarding/antigravitySetup.ts: cleanupModel and chatModel
  in ANTIGRAVITY_ONBOARDING are now `"auto"`. transcriptionModel is
  unchanged (`"gemini-3.5-transcribe"` is a transcription-mode sentinel, not
  a flash-tier chat model, and is still served).
- src/helpers/antigravityModels.ts and .cjs: DEFAULT_ANTIGRAVITY_MODEL
  (last-resort static fallback used only by the CLI subprocess path when no
  model was requested at all) bumped from gemini-3.7-flash-low to
  gemini-3.8-flash-low, with a comment clarifying it is not the settings
  default.
- src/models/modelRegistryData.json: added gemini-3.8-flash-low/medium/high
  rows to the antigravity provider (ahead of the 3.7 rows), with new
  descriptionKeys. Moved the "Latest Flash via Antigravity" description off
  3.7-high onto the new 3.8-high row; 3.7-high now reads "Previous Flash
  generation via Antigravity".
- src/locales/en/translation.json: added the 3 new
  models.descriptions.cloud.antigravity_gemini_3_8_flash_* keys and updated
  the 3.7-high description text. (Non-en locales are handled by L01, which
  also removes the retired 3.5 keys everywhere - see M03.)

Files changed
- src/stores/settingsStore.ts
- src/components/onboarding/antigravitySetup.ts
- src/helpers/antigravityModels.ts
- src/helpers/antigravityModels.cjs
- src/models/modelRegistryData.json
- src/locales/en/translation.json
- test/helpers/antigravityCli.test.js (updated one assertion for the new
  DEFAULT_ANTIGRAVITY_MODEL value)

Tests
- test/helpers/antigravityDefaultModel.test.js (new): fresh settings
  (cleared localStorage) resolve chatAgentModel/dictationAgentModel/
  cleanupModel to "auto" with provider "antigravity".
- test/helpers/antigravityRetiredFlashModels.test.js (new, shared with M03):
  checks the registry has 3.8 rows and only 3.8-high claims "latest".
- Command: `node --test test/helpers/antigravityDefaultModel.test.js
  test/helpers/antigravityRetiredFlashModels.test.js
  test/helpers/antigravityModels.test.js test/helpers/antigravityCli.test.js
  test/helpers/antigravityModelCatalog.test.js
  test/helpers/antigravityReasoning.test.js`
- before.txt / after.txt in this folder (same run as M03, one patch covers
  both findings).
- `npm run typecheck` clean.

Known follow-up: test/locales/translationCoverage.test.js now correctly
fails ("every en key is present in every other language") because the new
antigravity_gemini_3_8_flash_* keys only exist in en. That is L01's job
(commits after this one).

Commit: 1a29f5f3 "Point antigravity defaults and the picker at the models Antigravity still serves"
