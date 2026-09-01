# Debug Mode

Verbose logging for "no audio detected", failed transcription, paste, meetings, or Antigravity.

## Enable

### Command line

```bash
# macOS
/Applications/MoreOpenWhispr.app/Contents/MacOS/MoreOpenWhispr --log-level=debug

# Windows
MoreOpenWhispr.exe --log-level=debug

# Linux (deb/rpm binary is still named open-whispr)
open-whispr --log-level=debug
```

Packaged Windows builds keep logger output off stdout/stderr unless you also pass `--console-logs`.

### Environment file

Add to `.env` in the app data directory and restart:

```
OPENWHISPR_LOG_LEVEL=debug
```

**`.env` locations:**

- macOS: `~/Library/Application Support/MoreOpenWhispr/.env`
- Windows: `%APPDATA%\MoreOpenWhispr\.env`
- Linux: `~/.config/MoreOpenWhispr/.env`

## Log files

- **macOS:** `~/Library/Application Support/MoreOpenWhispr/logs/debug-*.log`
- **Windows:** `%APPDATA%\MoreOpenWhispr\logs\debug-*.log`
- **Linux:** `~/.config/MoreOpenWhispr/logs/debug-*.log`

## What gets logged

| Stage | Details |
| --- | --- |
| FFmpeg | Path resolution, permissions, ASAR unpacking |
| Audio recording | Permission requests, chunk sizes, audio levels |
| Audio processing | File creation, Whisper/Parakeet/Antigravity command, process output |
| IPC | Main ↔ renderer |
| Agent mode | Streaming, conversation, model selection |
| Meeting detection | Process monitoring, audio activity, calendar match |
| Meeting transcription | Sockets, audio buffering, echo-gate verdicts |
| Google / Microsoft Calendar | OAuth, token refresh, event sync (no event bodies at debug if we can help it) |
| Media control | Pause/resume, player detection |
| Audio storage | Retention, cleanup |

Loggers should emit `hasScreenContext` booleans, not screenshots. Still redact API keys and `agy` tokens before you attach a file to an issue.

## Common signatures

### No audio detected

- `maxLevel < 0.01` → too quiet
- `Audio appears to be silent` → mic or wrong device
- `FFmpeg not available` → path / unpack / Defender quarantine

### Transcription fails

- `Whisper stderr:` → whisper.cpp / FFmpeg
- `Process closed with code: [non-zero]`
- Antigravity: auth errors, 429 quota, missing `agy`

### Permissions

- `Microphone Access Denied`
- `isExecutable: false` → FFmpeg not executable

## Sharing logs

1. Enable debug, reproduce once
2. Grab the newest `debug-*.log`
3. Redact secrets
4. Attach to a [GitHub issue](https://github.com/SuperTost100/moreopenwhispr/issues)

## Disable

Remove `--log-level=debug` and `OPENWHISPR_LOG_LEVEL` from `.env`. Off by default.
