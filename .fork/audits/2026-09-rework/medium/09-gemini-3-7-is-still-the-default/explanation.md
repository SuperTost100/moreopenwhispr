# Gemini 3.7 is still the default

Importance: Medium importance

The current Antigravity catalog lists Gemini 3.8 Flash first. A fresh setup still starts on Gemini 3.7, and the picker has no 3.8 row.

`DEFAULT_ANTIGRAVITY_MODEL` in `src/helpers/antigravityModels.ts` and `src/helpers/antigravityModels.cjs` is `gemini-3.7-flash-low`. `resolveAgyCliModel` returns that id when the model string is empty. Onboarding in `src/components/onboarding/antigravitySetup.ts` writes `gemini-3.7-flash-low` for cleanup and `gemini-3.7-flash-medium` for chat. With no saved choice, `src/stores/settingsStore.ts` falls back to `gemini-3.7-flash-medium` for the chat agent and the dictation agent, and to `gemini-3.7-flash-high` for the vision model.

The Antigravity models in `src/models/modelRegistryData.json` stop at 3.7. There is no `gemini-3.8` id. The 3.7 high row is described as `Latest Flash via Antigravity`.

## What the run showed

`agy models` printed `gemini-3.8-flash-high` as the first row, then `gemini-3.8-flash-medium` and `gemini-3.8-flash-low`. `DEFAULT_ANTIGRAVITY_MODEL` was `gemini-3.7-flash-low`. An empty model resolved to `gemini-3.7-flash-low`. `registryHas38` was false. The 3.7 high description was `Latest Flash via Antigravity`.
