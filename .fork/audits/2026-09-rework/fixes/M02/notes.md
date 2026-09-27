# M02 - Selected transcription model is not sent

Status: ALREADY FIXED

## Reproduced on HEAD (47356a06)?

No. The audit's claim was against an older `antigravityGateway.js` with a hard-coded `GATEWAY_STT_MODELS`
list (`gemini-3.6-flash-low`, `gemini-3-flash`, `gemini-2.5-flash`) that ignored the caller's `model` arg
entirely. That code is gone. Found the fix via `git log -S resolveBackendModel -- src/helpers/antigravityGateway.js`:

```
5369b4f1 Rebuild the Antigravity transport on agy-owned auth, bounded gateway calls and a model catalog.
```
(2026-09-24, already on sync/upstream-2026-09 before this worktree's HEAD 47356a06)

## What actually happens now

Two separate things the audit conflated are both handled correctly on HEAD:

1. **The two top-level "Antigravity transcription" / "Antigravity transcription with live preview"
   registry entries** (`gemini-3.5-transcribe`, `gemini-3.5-transcribe-live` in `modelRegistryData.json`)
   are transcription *modes* (batch vs. live-preview), not real backend model ids -- and the UI labels say
   so ("Antigravity transcription" / "...with live preview"), they don't claim to be a specific Gemini
   model. `isAntigravityTranscribeModel()` treats both ids as synthetic, and
   `resolveAntigravityModels()` in `antigravityModelCatalog.js` explicitly never treats them as an explicit
   pick (comment: "Synthetic transcription-mode ids ... are modes, never explicit model picks") -- it always
   falls through to the auto/tiered catalog policy for these. `resolveBackendModel()` in
   `antigravityGateway.js` independently pins the same synthetic ids (and empty model) to
   `DEFAULT_STT_BACKEND_MODEL`. So there's no false claim: neither of these ids was ever presented as "you
   picked exactly this Gemini model."

2. **The real backend-model picker** is a separate control: Settings > Speech-to-text > Antigravity >
   "Speech-to-text model" (`AntigravitySettingsPanel.tsx`, `ModelSelectRow` fed by
   `window.electronAPI.antigravityListModels`, i.e. the live catalog). Picking a concrete catalog id there
   (e.g. `gemini-3.8-flash-tiered`) is stored as `antigravitySttModel`, flows through
   `antigravityPrefsFromPayload()` (`antigravityIpc.js`) into `antigravityPrefs.stt`, and
   `resolveAntigravityModels()` puts that pick first in `candidates.stt` (as long as it's in the catalog and
   audio-capable) -- see the already-existing `antigravityModelCatalog.test.js` coverage ("an explicit
   capable pick leads its slot"). That candidate is passed as `model` into `transcribeAudioViaGateway`,
   whose `resolveBackendModel()` only rewrites empty/synthetic ids, so a real explicit pick reaches the
   gateway request body (`buildEnvelope`'s `model` field) unchanged.

Picking "Automatic" sends whatever the catalog's tiered policy resolves to for the `stt` slot (currently
`gemini-3.8-flash-tiered` from the live/fallback catalog), which is exactly what the "Automatic" label
promises -- an automatically chosen model, not a specific named one.

## Test

Added a regression test at the layer the audit's original claim was about (the gateway request body), since
nothing already pinned that an explicit `model` argument survives into the wire payload:

`test/helpers/antigravityGateway.test.js`:
- "transcribeAudioViaGateway puts the caller's resolved model in the request body" (new) -- spins up a local
  HTTP server, has it echo back the `model` field it received in the JSON body, and asserts
  `transcribeAudioViaGateway({ model: "gemini-3.8-flash-tiered" })` results in that exact id reaching the
  server and coming back in `result.model`.

Combined with the existing `antigravityModelCatalog.test.js` ("an explicit capable pick leads its slot") and
`antigravityGateway.test.js` ("resolveBackendModel pins empty/synthetic transcribe ids to the known-good
default"), the full chain (catalog resolves an explicit pick -> passed as `model` -> reaches the request
body unchanged) is covered end to end.

Command:
```
node --test test/helpers/antigravityGateway.test.js
```
23/23 pass (see after.txt).

## Commit

Commit `00e3e478` "Pin the explicit Antigravity STT model pick to the gateway request body"
(sync/upstream-2026-09; test-only, no source change needed).
