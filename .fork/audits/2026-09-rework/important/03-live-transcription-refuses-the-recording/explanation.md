# Live transcription rejects the recording itself

Importance: Important

Gemini 3.5 Transcribe Live is a selectable Antigravity model. If the live preview stream does not hand back a committed transcript, the recording is not transcribed. The batch path throws and stops.

`transcribeWithAntigravity` in `src/helpers/antigravityTranscription.js` hits this before it converts audio or calls the gateway, when the model is `gemini-3.5-transcribe-live`:

`Antigravity live transcription must use the live preview stream during recording.`

The error code is `AGY_LIVE_REQUIRES_PREVIEW`. That throw sits outside the gateway fallback, so the older `agy` write-file path does not run either. `processWithOpenAIAPI` in `src/helpers/audioManager.js` only skips the batch call when the preview stop already returned non-empty streamed text with `streamed: true`. An empty or truncated live flush falls through to this throw.

## What the run showed

`transcribeWithAntigravity` was called with model `gemini-3.5-transcribe-live` and a wav buffer. It threw `AGY_LIVE_REQUIRES_PREVIEW` and the message above. The access-token function was never called.
