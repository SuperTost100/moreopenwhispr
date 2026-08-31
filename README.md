# MoreOpenWhispr (MOW)

**Unofficial fork** of [OpenWhispr](https://github.com/OpenWhispr/openwhispr). Desktop dictation with **Gemini, Antigravity, BYOK, and local** models. No OpenWhispr Cloud account, no Pro upsells, no telemetry.

Not OpenWhispr. Not Gizmo Labs. Not Google.

## What you get

- Antigravity (`agy`) subscription STT and LLM (fast batch + optional live preview)
- Cloud Providers mode: your own API keys (OpenAI, Anthropic, Gemini, etc.)
- Local Whisper / Parakeet
- Calendar integrations, local notes, hotkeys
- **Local CLI** (`openwhispr --local …`) talks to the running app on localhost

## What MOW does not include

These need **OpenWhispr Cloud Pro** on the official app. MOW removes them on purpose:

- OpenWhispr Cloud transcription mode (free account)
- Hosted MCP (`mcp.openwhispr.com`)
- CLI cloud mode (`openwhispr auth login`)
- Account, billing, workspace, referrals, usage analytics

## Requirements

- macOS (Apple Silicon build below)
- For Antigravity path: `agy` on PATH + `agy auth login`
- For BYOK: your provider API keys in Settings

## Download

[GitHub Releases](https://github.com/tost1/openwhispr/releases) on branch `antigravity-fork`.

Unsigned build: right-click the app → **Open** on first launch.

## Build

```bash
nvm use 24
npm ci
npm run compile:native
npm run pack
# dist/mac-arm64/MoreOpenWhispr.app
```

## Fork vs upstream

| | **MOW** | **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)** |
|---|---|---|
| Cloud account | Removed | Optional free + Pro |
| STT / LLM | Antigravity, BYOK, local | + OpenWhispr Cloud |
| MCP / cloud CLI | Removed | Pro |
| Telemetry | Off, UI removed | Opt-in toggle |

Upstream README: [README.upstream.md](./README.upstream.md). Technical notes: [.fork/ANTIGRAVITY.md](./.fork/ANTIGRAVITY.md). Compliance: [.fork/COMPLIANCE.md](./.fork/COMPLIANCE.md).

## License

MIT (upstream). Keep [LICENSE](./LICENSE) with any distribution. Edit `src/config/mowProfile.ts` repo URLs before publishing.
