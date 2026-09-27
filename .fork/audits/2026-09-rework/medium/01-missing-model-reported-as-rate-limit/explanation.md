# A missing model is reported as a rate limit

Importance: Medium importance

When both Cloud Code hosts answer 404 for a model, `generateContent` in `src/helpers/antigravityGateway.js` still throws with HTTP status 429. The UI then uses the rate-limit string, `hooks.audioRecording.errorDescriptions.providerRateLimited`, even though the body says the model was not found.

After a 404 or a 429, the inner retry loop breaks and the next host is tried. When the hosts are exhausted, the function calls `throwGatewayFailure(429, lastBody)` regardless of the status that was actually returned.

## What the run showed

Both hosts were asked for `gemini-3.7-flash-low` and both returned 404 with `models/gemini-3.7-flash-low is not found`. The thrown error had `status` 429, `code` `AGY_ERROR`, and `messageKey` `hooks.audioRecording.errorDescriptions.providerRateLimited`. The message text was still the not-found string.
