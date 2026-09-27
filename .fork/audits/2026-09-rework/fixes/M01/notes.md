Status: ALREADY FIXED

Root cause (as audited): the old two-host retry loop in `generateContent`
broke out of the inner loop on either a 404 or a 429, then, once both hosts
were exhausted, called `throwGatewayFailure(429, lastBody)` unconditionally —
rewriting a genuine 404 model-not-found response into a hardcoded HTTP 429.
The renderer then picked the rate-limit messageKey
(`hooks.audioRecording.errorDescriptions.providerRateLimited`) even though the
body text said the model was not found.

What fixed it: the gateway rewrite (5369b4f1 "Rebuild the Antigravity
transport on agy-owned auth, bounded gateway calls and a model catalog.", and
0d8ecaf1) replaced the two-host cascade with a single Cloud Code base
(`DAILY_CLOUDCODE_BASE`; the prod base always 429s on this account tier per
the module comment, so it's no longer tried) and typed error classification in
`throwTypedGatewayError` (src/helpers/antigravityGateway.js): a 404 always
throws `AGY_MODEL_UNAVAILABLE` with the real `status: 404` preserved, never
rewritten to 429. This holds both for a single attempt and for the
candidate-model failover loop in `runAntigravityChatTurn`
(src/helpers/antigravityChatGateway.js) — `decideAntigravityFailover` treats
`AGY_MODEL_UNAVAILABLE` as `{ action: "failover", refreshCatalog: true }`, and
once every candidate is exhausted the loop rethrows `lastError` as-is (never
rewrites the status).

The renderer mapping in src/utils/recordingErrors.ts
(`getRecordingErrorTitle`/`getRecordingErrorDescription`) checks
`error.code === "AGY_MODEL_UNAVAILABLE"` before the generic
`if (error.messageKey) return t(error.messageKey)` fallback, so it always
resolves to `hooks.audioRecording.errorTitles.antigravityModelUnavailable` /
`hooks.audioRecording.errorDescriptions.antigravityModelUnavailable`, never the
rate-limit strings.

Files changed: none (already fixed on HEAD). Added regression tests:
  - test/helpers/antigravityChatGateway.test.js — "runAntigravityChatTurn
    surfaces a 404 as AGY_MODEL_UNAVAILABLE with status 404 once every
    candidate model has been tried, never a rate-limit error" (both candidate
    models 404, asserts the final thrown error keeps status 404 / code
    AGY_MODEL_UNAVAILABLE).
  - test/utils/recordingErrors.test.js (new file) — asserts the renderer
    mapping picks the not-found title/description for AGY_MODEL_UNAVAILABLE,
    including a guard that a stray rate-limit `messageKey` on the error object
    can't leak through ahead of the code-specific branch.
  - Pre-existing: test/helpers/antigravityGateway.test.js already had
    "generateContent surfaces a 404 as AGY_MODEL_UNAVAILABLE with the real
    status" at the single-request level.

Test commands:
  `node --test test/helpers/antigravityChatGateway.test.js`
  `node --test test/helpers/antigravityGateway.test.js`
  `node --import tsx --test test/utils/recordingErrors.test.js`

Commit that fixed it: 5369b4f1 / 0d8ecaf1 (already on HEAD 47356a06, no new
fix commit needed for this finding).
