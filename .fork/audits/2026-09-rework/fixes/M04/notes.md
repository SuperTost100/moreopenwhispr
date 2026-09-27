# M04 - Antigravity audio conversion has no deadline

Status: FIXED NOW

## Reproduced on HEAD (47356a06)?

Yes, for the exported `prepareAudioBuffer` used without an `op`. The conversion already runs async
(`convertToWavAsync` via `spawn`, not `spawnSync`), and when a caller passes an `op` (as
`transcribeWithAntigravity` always does internally), `op.stageSignal(120_000)` gives ffmpeg a bounded
abort signal. But `prepareAudioBuffer` is an exported function and its `op` param is optional; without one,
`ffmpegSignal` was `undefined` and `convertToWavAsync` had nothing to abort on, so it waited for the child
to exit on its own. Pointed at a stand-in ffmpeg that only runs `sleep 30`, the call hung for the full 30s.

Confirmed a second, more serious bug while writing the test: even when an abort signal *did* fire (e.g. via
`op`), `convertToWavAsync` only killed the direct child pid (`child.kill("SIGKILL")`). For a shell-script
"ffmpeg" (or any real ffmpeg invocation that forks a helper), killing just the top pid orphans whatever it
forked, and that orphan keeps the child's inherited stdio pipes open -- in the test this alone kept the whole
node test process alive for the fake ffmpeg's full 30s sleep even though the promise itself rejected in
~500ms. This is the same shape of bug for `transcribeWithAntigravityLegacyAgent`'s ffmpeg conversion, which
had the identical `op?.stageSignal(120_000) : undefined` pattern.

## Root cause

1. No deadline at all for `prepareAudioBuffer`/`transcribeWithAntigravityLegacyAgent` callers that don't pass
   `op`.
2. Killing only the direct child pid on abort leaves an orphaned grandchild process running and holding
   stdio pipes open, even when a deadline exists.

## Fix

`src/helpers/antigravityTranscription.js`:
- Added `ffmpegConversionSignal(op, timeoutMs)`: uses `op.stageSignal(120_000)` when an operation is present
  (unchanged budget/behavior for the normal `transcribeWithAntigravity` path), otherwise falls back to
  `AbortSignal.timeout(timeoutMs)` with a new `DEFAULT_FFMPEG_CONVERT_TIMEOUT_MS` (20s) default. Both
  `prepareAudioBuffer` and `transcribeWithAntigravityLegacyAgent` now accept an optional `ffmpegTimeoutMs`
  (test-injectable) and use this helper instead of the old `op?.stageSignal(...) : undefined` inline.
- `convertToWavAsync` now spawns ffmpeg `detached: true` (non-Windows) so it gets its own process group, and
  on abort kills the whole group (`process.kill(-child.pid, "SIGKILL")`), falling back to `child.kill()` on
  Windows or if the group kill fails. This matches the sidecar-process convention already used elsewhere in
  the codebase (own process group + explicit kill).

## Test

`test/helpers/antigravityTranscription.test.js`:
- "prepareAudioBuffer kills a stuck ffmpeg and rejects within the timeout instead of hanging" (new)

Uses a temp shell script standing in for ffmpeg (`echo $$ > pidfile; sleep 30`) so the test can verify both
that the call rejects within the injected timeout (not 30s) and that the recorded pid is actually dead
afterward (no orphan). Before the process-group fix, the orphaned `sleep` kept the whole test process alive
for the remainder of its sleep even though the promise itself resolved -- confirmed by timing the bare
`node --test` run (30s+ wall clock before the fix, ~0.6-2s after, see before.txt / after.txt timestamps and
`time` output captured during development).

Command:
```
node --test test/helpers/antigravityTranscription.test.js
```

## Commit

Commit `ddff2862` "Fall back live transcription to batch instead of throwing, and bound ffmpeg conversion"
(sync/upstream-2026-09; covers I03 + M04 together, same file, same STT-conversion code path).
