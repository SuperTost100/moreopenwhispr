# Antigravity audio conversion has no deadline

Importance: Medium importance

Dictation that needs a wav conversion calls `convertToWav` in `src/helpers/antigravityTranscription.js`. That function uses `spawnSync` and does not pass a `timeout`. The dictation request stays on that call until ffmpeg exits. A stuck ffmpeg holds the transcription for as long as the process lives.

`prepareAudioBuffer` is the exported caller. It runs the conversion whenever `ffmpegPath` is set and the input is not already wav.

## What the run showed

`prepareAudioBuffer` was pointed at a stand-in binary that only runs `sleep 30`. The call did not return until that sleep finished. `settledAfterMs` was 31669.
