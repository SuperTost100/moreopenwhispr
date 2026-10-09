# Fork: Antigravity (`agy`) backend

Subscription-only AI via Antigravity OAuth + Cloud Code Assist gateway. OpenWhispr pipelines, prompts, and tools stay upstream; only the model transport is forked.

Public setup: [docs/antigravity.md](../docs/antigravity.md). Product name: **MoreOpenWhisperer** (`com.moreopenwhispr.app`).

## Architecture (dictation speed)

Dictation STT uses the **daily Cloud Code gateway** (`daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`) with OAuth from `agy auth login`. Audio is sent inline with a transcription system prompt. One round trip when the gateway path succeeds.

| Path                                 | Latency (warm, ~7 s clip) | Use                                                                           |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------------------- |
| Daily gateway stream (catalog model) | ~1.2–2.5 s                | **Default** dictation STT                                                     |
| Gateway text (cleanup slot)          | ~1–2 s                    | Optional cleanup when Polished mode                                           |
| `agy --print` subprocess             | ~14–22 s                  | Fallback only when the network is unreachable and budget remains              |
| Rolling PCM preview on gateway       | ~2 s cadence              | Live preview only (6 s stage cap); final text comes from a full-clip STT pass |

**Credentials:** `agy` is the account of record for `~/.gemini/antigravity-cli/antigravity-oauth-token`. The app refreshes that token itself, directly against Google, using the OAuth client id/secret extracted in-process from the `agy` binary (`extractCredentialsFromFile` in `antigravityAuth.js` — chunked fs read, no `strings` subprocess, cached by the binary's realpath+mtime+size). Only a sha256 fingerprint of the client id that last worked is persisted (`antigravity-oauth-client.json` in userData), so the next refresh tries it first; no secret, refresh token, or access token is ever written outside the agy-owned token file. If extraction finds nothing or every candidate pair is rejected, it falls back to the old `agy models` delegation. Either way, only `agy auth login` can mint a new refresh token, so a dead one still surfaces as `AGY_AUTH_REQUIRED`.

**Models:** `fetchAvailableModels` populates a persisted catalog. Settings offer **Automatic (latest)** (tier order + pinned `gemini-2.5-flash-lite` fallback) or an explicit gateway id per slot (STT / cleanup / chat). Synthetic ids `gemini-3.5-transcribe*` are **modes** (SMART/VERBATIM, live preview), not gateway model ids.

**Failover:** Within one operation budget, STT/cleanup walk `candidates.<slot>` on stage timeout, HTTP 5xx, model unavailable, model-scoped rate limits, or empty output (STT with speech). Account quota exhaustion, auth required, cancel, and safety blocks stop immediately. One 401 retry refreshes the token. While other candidates are still queued, one attempt gets 60% of the remaining budget (at least 4 s), so a stalled model leaves time to try the next one. Model cooldowns also cover the pinned fallback. The catalog and cooldowns belong to the signed-in agy account; signing in with another account drops both and refetches the catalog. A 403 drops the cached project id, so the next request looks it up again.

**Budgets & cancel:** IPC builds `createAntigravityOperation` per request (`requestId` → `AbortController`; `cloud-transcribe-cancel` aborts the sender's in-flight Antigravity work, which also stops any `agy` child it started: SIGTERM, then SIGKILL after 3 s). STT budget = 12 s + 0.5 × audio seconds (cap 90 s; unknown duration assumes 30 s). FFmpeg convert is async and killed on abort.

**Fast mode (default):** SMART transcribe skips the separate cleanup pass (`shouldSkipAntigravityDictationCleanup`).

**Polished mode:** SMART transcribe + optional cleanup via the cleanup slot on the gateway.

## Live STT

Mode id `gemini-3.5-transcribe-live`: rolling PCM preview (~2 s) on the gateway with a 6 s stage timeout (no subprocess). `finish()` returns `{ final: true }` only when the full-clip gateway STT succeeds; otherwise the main IPC STT path runs with its own budget.

## Owned files (safe to keep on rebase)

- `src/helpers/antigravityAuth.js`
- `src/helpers/antigravityOperation.js`
- `src/helpers/antigravityFailover.js`
- `src/helpers/antigravityIpc.js`
- `src/helpers/antigravityGateway.js`
- `src/helpers/antigravityModelCatalog.js`
- `src/helpers/antigravityTranscriptionPolicy.js`
- `src/helpers/antigravityCli.js`
- `src/helpers/antigravityTranscription.js`
- `src/helpers/antigravityReasoning.js`
- `src/helpers/antigravityLiveTranscription.js`
- `src/services/ai/inferenceProviders/antigravity.ts`
- `src/services/ai/antigravityChat.ts`
- `src/components/onboarding/antigravitySetup.ts`
- `src/components/settings/AntigravityStatus.tsx`
- `src/config/mowProfile.ts` / `mowProfile.cjs`
- `test/helpers/antigravity*.test.js`
- `test/components/antigravitySetup.test.js`
- `scripts/bench-antigravity-models.mjs`
- `scripts/refresh-antigravity-token.js`
- `.fork/ANTIGRAVITY.md` (this file)

## What still uses `agy` subprocess

- Chat tool loop (`runToolLoopTurn`) — Phase B migrates this to the gateway
- Reasoning with screen context (multimodal image in isolated temp dir)
- STT/cleanup emergency fallback when the gateway cannot be reached over the network

## Troubleshooting (AGY_* codes)

Settings shows the sign-in state under the Antigravity provider (`antigravity-status` IPC: CLI missing, signed out, signed in, or unknown when offline).

| Code                         | Meaning                         | What to do                                                              |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| `AGY_AUTH_REQUIRED`          | Token missing or refresh failed | Run `agy auth login` in a terminal                                      |
| `AGY_RATE_LIMITED` (account) | Subscription quota exhausted    | Wait for reset; check Antigravity quota UI                              |
| `AGY_RATE_LIMITED` (model)   | Temporary model throttle        | Automatic failover tries another catalog model                          |
| `AGY_TIMEOUT`                | Stage or budget exceeded        | Shorter clip, check network, or pick a faster model                     |
| `AGY_MODEL_UNAVAILABLE`      | 404 or retirement notice        | Refresh catalog (automatic on failure); pick Automatic or another model |
| `AGY_CANCELLED`              | User cancelled dictation        | Expected; retry dictation                                               |
| `AGY_BLOCKED`                | Safety filter                   | Rephrase or change content                                              |

Measure models locally: `node scripts/bench-antigravity-models.mjs` (never prints tokens).
