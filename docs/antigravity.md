# Antigravity

MoreOpenWhispr can send dictation and LLM work through your existing Antigravity (`agy`) login instead of OpenWhispr Cloud or a BYOK key.

This is **your** Google/Antigravity subscription. The app is a local client. It is not a Google product, and it is not a way to get unlimited free transcription.

## Install the CLI

`agy` must be on PATH in the same environment that launches the desktop app.

```bash
agy --version
agy auth login
```

Token file (do not commit it, do not paste it into issues):

```
~/.gemini/antigravity-cli/antigravity-oauth-token
```

Windows: a Start Menu / tray launch will not see a PATH you only exported in a VS Code terminal. Install `agy` system-wide or set the user PATH, then log out.

Override the binary with `ANTIGRAVITY_CLI=/full/path/to/agy` if needed.

## In the app

Onboarding offers Antigravity when `agy` is signed in. Fresh settings default to:

- Transcription provider `antigravity`, model `gemini-3.5-transcribe`
- Dictation mode **Fast** (SMART transcribe, skip a second cleanup pass)
- Cleanup / agent / chat also on Antigravity (`gemini-3.5-flash-low`) when you stay on that stack

Settings → Speech → Dictation (with Antigravity selected):

| Control | Meaning |
| --- | --- |
| Fast | One gateway round trip. Default. |
| Polished | Same transcribe, then an optional flash-low cleanup |
| Smart / Verbatim | How aggressive the transcribe prompt is |

Live preview uses rolling PCM (about every 2 seconds) on the same daily Cloud Code gateway. A dedicated `gemini-3.5-transcribe-live` endpoint is not used.

## What actually runs

| Path | Typical latency | When |
| --- | --- | --- |
| Daily Cloud Code stream + flash-low audio | ~1–3s | Default dictation STT |
| Gateway text flash-low | ~1–2s | Polished cleanup |
| `agy --print` subprocess | ~10–30s | Emergency fallback if the gateway fails |
| Gateway + rolling WAV | ~2s updates | Live preview |

Chat tool loops and reasoning with a screen-context screenshot still shell out to `agy`. Plain text cleanup stays on HTTP.

Hosts: `oauth2.googleapis.com`, `daily-cloudcode-pa.googleapis.com`, `cloudcode-pa.googleapis.com`. Full list: [network-allowlist.md](network-allowlist.md).

## If it fails

1. `agy auth login` again. Expired tokens are the usual cause.
2. Confirm `which agy` in a **login** shell, not only in your IDE.
3. Quota 429s are Google's, not MoreOpenWhispr's. Switch to local Whisper/Parakeet or a BYOK key.
4. Debug log: [DEBUG.md](../DEBUG.md).

## Maintainer notes

File list, upstream touch points, and rebase rules: [.fork/ANTIGRAVITY.md](../.fork/ANTIGRAVITY.md). Compliance before you attach binaries to a Release: [.fork/COMPLIANCE.md](../.fork/COMPLIANCE.md).
