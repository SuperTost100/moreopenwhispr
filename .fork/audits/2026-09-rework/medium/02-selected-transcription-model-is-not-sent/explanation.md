# The transcription model in the picker is not the model that is sent

Importance: Medium importance

The Antigravity speech model in the registry is `gemini-3.5-transcribe`, named Gemini 3.5 Transcribe. `transcribeAudioViaGateway` in `src/helpers/antigravityGateway.js` accepts that `model` argument and does not send it. The request loop always uses `GATEWAY_STT_MODELS`, which starts at `gemini-3.6-flash-low`, then `gemini-3-flash`, then `gemini-2.5-flash`.

## What the run showed

The call requested `gemini-3.5-transcribe`. The gateway body contained `gemini-3.6-flash-low`. The returned model was `gemini-3.6-flash-low`.
