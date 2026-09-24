# Antigravity

MoreOpenWhisperer can send dictation and LLM work through your existing Antigravity (`agy`) login instead of OpenWhispr Cloud or a BYOK key.

This is **your** Google/Antigravity subscription. The app is a local client. It is not a Google product, and it is not a way to get unlimited free transcription.

## Install the CLI

`agy` must be installed. The desktop app looks on PATH plus `~/.local/bin` and Homebrew, because a Finder/Dock launch does not inherit your Terminal PATH.

```bash
agy --version
agy auth login
```

Token file (do not commit it, do not paste it into issues):

```
~/.gemini/antigravity-cli/antigravity-oauth-token
```

`agy` refreshes and rewrites that file; the app only reads it and runs `agy models` when the token is near expiry.

Windows: a Start Menu / tray launch will not see a PATH you only exported in a VS Code terminal. Install `agy` system-wide or set the user PATH, then log out.

Override the binary with `ANTIGRAVITY_CLI=/full/path/to/agy` if needed.

## In the app

Onboarding offers Antigravity when `agy` is signed in. Fresh settings default to:

- Transcription provider `antigravity`, mode `gemini-3.5-transcribe` (not a gateway model id)
- Backend models **Automatic (latest)** for STT, cleanup, and chat (catalog tiers + pinned fallback)
- Dictation mode **Fast** (SMART transcribe, skip a second cleanup pass)

Settings → Speech → Dictation (with Antigravity selected):

| Control                                   | Meaning                                       |
| ----------------------------------------- | --------------------------------------------- |
| Fast / Polished                           | Skip or run the cleanup pass after transcribe |
| Smart / Verbatim                          | Transcribe prompt style                       |
| Transcription / Cleanup / Assistant model | Explicit gateway id or Automatic              |

Mode ids `gemini-3.5-transcribe` and `gemini-3.5-transcribe-live` only choose SMART/VERBATIM and live preview; gateway ids come from the catalog picker.

## What actually runs

| Path                                    | Typical latency (warm) | When                                        |
| --------------------------------------- | ---------------------- | ------------------------------------------- |
| Daily Cloud Code stream (catalog model) | ~1.2–2.5 s             | Default dictation STT                       |
| Gateway text (cleanup slot)             | ~1–2 s                 | Polished cleanup                            |
| `agy --print` subprocess                | ~14–22 s               | Network unreachable only; no `--model` flag |
| Gateway + rolling WAV                   | ~2 s updates           | Live preview (6 s stage cap)                |

Each dictation request gets one **operation budget** (STT: 12 s + 0.5 × audio length, cap 90 s). Failover tries the next catalog candidate on timeouts, 5xx, retired models, and model-scoped rate limits. Cancel stops the matching `requestId` and kills an in-flight CLI child.

Chat tool loops and reasoning with a screen-context screenshot still shell out to `agy` (Phase B moves tools to the gateway).

Hosts: `oauth2.googleapis.com`, `daily-cloudcode-pa.googleapis.com`. Full list: [network-allowlist.md](network-allowlist.md).

## If it fails

| Symptom                       | Fix                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Sign-in / `AGY_AUTH_REQUIRED` | Run `agy auth login` in a terminal                                                    |
| Quota / account rate limit    | Wait for reset; check Antigravity quota                                               |
| Timeout                       | Shorter clip, faster model, or check network                                          |
| Model unavailable             | Settings → Automatic, or pick another catalog model                                   |
| Slow every time               | Run `node scripts/bench-antigravity-models.mjs` to compare models (tokens stay local) |

Refresh token before expiry (cron-friendly):

```bash
node scripts/refresh-antigravity-token.js --min-ttl-sec 1500
```

Debug log: [DEBUG.md](../DEBUG.md).

## Maintainer notes

File list, failover, and rebase rules: [.fork/ANTIGRAVITY.md](../.fork/ANTIGRAVITY.md). Compliance before you attach binaries to a Release: [.fork/COMPLIANCE.md](../.fork/COMPLIANCE.md).
