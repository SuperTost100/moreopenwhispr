# Contributing to MoreOpenWhisperer

Unofficial fork of [OpenWhispr](https://github.com/OpenWhispr/openwhispr). Shipping branch is `antigravity-fork`.

Upstream's contributing guide still applies for how the Electron app is structured: [docs.openwhispr.com/contributing](https://docs.openwhispr.com/contributing). File MoreOpenWhisperer PRs here, not there, unless the fix belongs upstream.

## Filing issues

- Bugs and feature requests: [SuperTost100/moreopenwhispr/issues](https://github.com/SuperTost100/moreopenwhispr/issues)
- Use the issue templates (`bug_report`, `feature_request`)
- Transcription or audio problems: attach debug logs. [DEBUG.md](../DEBUG.md) and [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)

Do not send Antigravity OAuth tokens, API keys, or `.env` contents.

## Reporting security issues

**Do not open a public issue.** Follow [SECURITY.md](../SECURITY.md). Use [private vulnerability reporting](https://github.com/SuperTost100/moreopenwhispr/security/advisories/new).

## Contributing code

1. Branch off `antigravity-fork` (not stale `main` unless it already matches).
2. Keep the diff focused.
3. `nvm use` (Node 24), then `npm ci`, `npm run lint`, `npm test`.
4. Open a pull request against `SuperTost100/moreopenwhispr` `antigravity-fork`.

### Local setup

| Requirement | Notes |
| --- | --- |
| Node.js | Pinned in [`.nvmrc`](../.nvmrc) (24) |
| Install | `npm ci` |
| Run | `npm run dev` |
| Lint / format | `npm run lint` / `npm run format` |
| Tests | `npm test` |
| Build | [docs/building.md](../docs/building.md) (`build:mac` / `build:win` / `build:linux`) |

Platform install: [docs/macos.md](../docs/macos.md), [docs/windows.md](../docs/windows.md), [docs/linux.md](../docs/linux.md). Local Whisper: [LOCAL_WHISPER_SETUP.md](../LOCAL_WHISPER_SETUP.md). Antigravity: [docs/antigravity.md](../docs/antigravity.md).

Changes to account, billing, or OpenWhispr Cloud should go upstream. This fork keeps those surfaces disabled.

## Thanks

Issues, logs, and small diffs are useful. A second UI redesign is happening on another branch; this one is the stable beta people should actually run.
