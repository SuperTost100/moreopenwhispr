# Fork: Antigravity (`agy`) backend

Subscription-only AI via Antigravity OAuth + Cloud Code Assist gateway. OpenWhispr pipelines, prompts, and tools stay upstream; only the model transport is forked.

Public setup: [docs/antigravity.md](../docs/antigravity.md). Product name: **MoreOpenWhispr** (`com.moreopenwhispr.app`).

## Architecture (dictation speed)

Dictation STT uses the same **daily Cloud Code gateway** as the `agy` CLI (`daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`) with OAuth from `agy auth`. Audio is sent inline to `gemini-3.5-flash-low` with a transcription system prompt. One round trip, no agent subprocess.

| Path | Latency | Use |
| --- | --- | --- |
| Daily gateway stream + flash-low multimodal | ~1–3s | **Default** dictation STT |
| Gateway + `gemini-3.5-flash-low` text | ~1–2s | Optional cleanup when Polished mode |
| `agy --print` agent | ~10–30s+ | Emergency fallback only if gateway fails |
| Rolling PCM (~2s) on the same daily path | Live preview | Preview + stream commit at stop |

**Fast mode (default):** SMART transcribe skips the separate cleanup pass (`shouldSkipAntigravityDictationCleanup`).

**Polished mode:** SMART transcribe + optional flash-low cleanup via daily gateway.

## Live STT

Dedicated `gemini-3.5-transcribe-live` returned 404 on the daily gateway. Implemented as a **rolling PCM buffer**: every ~2s of audio, cumulative WAV goes through `streamGenerateContent`; preview updates via existing dictation-preview IPC.

## Owned files (safe to keep on rebase)

- `src/helpers/antigravityAuth.js`
- `src/helpers/antigravityGateway.js`
- `src/helpers/antigravityTranscriptionPolicy.js`
- `src/helpers/antigravityCli.js`
- `src/helpers/antigravityTranscription.js`
- `src/helpers/antigravityReasoning.js`
- `src/services/ai/inferenceProviders/antigravity.ts`
- `src/services/ai/antigravityChat.ts`
- `src/components/onboarding/antigravitySetup.ts`
- `src/config/mowProfile.ts` / `mowProfile.cjs`
- `test/helpers/antigravity*.test.js`
- `test/components/antigravitySetup.test.js`
- `.fork/ANTIGRAVITY.md` (this file)

## Upstream touch points (re-apply after merge)

| File | Change |
| --- | --- |
| `src/models/modelRegistryData.json` | `antigravity` in `transcriptionProviders` + `cloudProviders` |
| `src/helpers/transcriptionRoute.ts` | proxied provider + `resolveByokModel` |
| `src/helpers/audioManager.js` | `PROXY_TRANSCRIPTION_PROVIDERS.antigravity`, skip cleanup |
| `src/helpers/ipcHandlers.js` | proxy STT, reasoning, tool-turn, availability handlers |
| `preload.js` | IPC bridges |
| `src/types/electron.ts` | API types |
| `src/services/ai/inferenceProviders/index.ts` | registry entry |
| `src/services/ReasoningService.ts` | `isAvailable` + streaming antigravity branch |
| `src/stores/settingsStore.ts` | fork defaults + antigravity mode settings |
| `src/components/onboarding/*` | Antigravity setup path |

## Defaults (fresh installs / empty localStorage)

- Transcription: provider `antigravity`, model `gemini-3.5-transcribe`, mode `providers`
- `antigravityDictationMode`: `fast` (skip cleanup after SMART transcribe)
- `antigravityTranscriptionMode`: `smart`
- Cleanup / agent / chat: provider `antigravity`, cleanup model `gemini-3.5-flash-low`

## Runtime requirements

- `agy` on PATH, signed in (`agy auth login`). OAuth token file must exist
- Optional `ffmpeg-static` for webm→wav before gateway transcribe

## Distribution

- GitHub: [SuperTost100/openwhispr](https://github.com/SuperTost100/openwhispr), branch `antigravity-fork`
- Releases: unsigned macOS / Windows / Linux via `.github/workflows/release.yml`
- Account / billing UI disabled via `src/config/mowProfile.ts`
- `repoUrl` / `issuesUrl` / `docsUrl` live in `mowProfile.ts` (keep them pointing at SuperTost100)

## What still uses `agy` subprocess

- Chat tool loop (`runToolLoopTurn`)
- Reasoning with screen context (multimodal image in isolated temp dir)

Text-only cleanup uses gateway HTTP when no screen context is attached.

## Follow-ups

- Tune live chunk interval / overlap for lower preview latency
- Settings UI: Fast/Polished and Smart/Verbatim (Speech → Dictation when Antigravity is selected)
