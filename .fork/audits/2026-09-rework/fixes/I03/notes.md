# I03 - Live transcription refuses the recording

Status: FIXED NOW

## Reproduced on HEAD (47356a06)?

Yes. `transcribeWithAntigravity` in `src/helpers/antigravityTranscription.js` threw `AGY_LIVE_REQUIRES_PREVIEW`
as soon as it saw `model === "gemini-3.5-transcribe-live"`, before touching auth, ffmpeg, or the gateway. This
function is only reached with that model id when the live preview stream failed to commit a clean transcript
(empty or truncated flush) -- `audioManager.js` (`processWithLocalParakeet` and `processWithOpenAIAPI`) only
skip straight to `processTranscription` when the preview already returned non-empty `streamedText`. So an
empty/truncated live flush fell through to this throw and the recording was lost, matching the audit exactly.

Checked `audioManager.js` for the gap the brief called out (`streamed:true` with empty text treated as
success): both `metadata.streamedText` checks trim the string and only take the streamed branch when it is
truthy, so an empty streamed transcript already falls through to the batch call. No fix needed there.

## Root cause

The live model id was treated as a hard requirement instead of a synthetic "mode" id. Nothing downstream
(gateway, model catalog) actually needs `gemini-3.5-transcribe-live` as a real backend model; the batch
resolver already ignores it (`isAntigravityTranscribeModel` in `antigravityModelCatalog.js`'s explicit-pick
check). The early throw was the only place the live id caused a hard failure.

## Fix

Removed the throw. When `transcribeWithAntigravity` is reached with the live model id, it now logs
`live-fallback-to-batch` and falls straight through to the same batch STT gateway path used for the
non-live model (same catalog candidates, same failover, same legacy-agent fallback). The returned result
carries `fellBackFromLive: true` so callers/logs can tell a fallback happened.

Files changed:
- `src/helpers/antigravityTranscription.js`: removed the `AGY_LIVE_REQUIRES_PREVIEW` throw, added the
  `fellBackFromLive` flag and log stage, propagated the flag onto all three success return points (gateway
  success, subprocess failover mid-loop, subprocess failover after network-unreachable exhaustion).

## Test

`test/helpers/antigravityTranscription.test.js`:
- "transcribeWithAntigravity falls back to the batch gateway for the live model instead of throwing" (new)

Command:
```
node --test test/helpers/antigravityTranscription.test.js
```

Before: `AGY_LIVE_REQUIRES_PREVIEW` thrown, gateway never called (see before.txt, second failure block).
After: gateway called, `result.text === "spoken words"`, `result.fellBackFromLive === true`.

## Commit

Commit `ddff2862` "Fall back live transcription to batch instead of throwing, and bound ffmpeg conversion"
(sync/upstream-2026-09; covers I03 + M04 together, same file).
