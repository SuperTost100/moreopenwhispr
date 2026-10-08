<p align="center">
  <img src="src/assets/logo.svg" alt="MoreOpenWhisperer" width="120" />
</p>

<h1 align="center">MoreOpenWhisperer</h1>

<p align="center">
  <a href="https://github.com/SuperTost100/moreopenwhispr/blob/main/LICENSE"><img src="https://img.shields.io/github/license/SuperTost100/moreopenwhispr?style=flat" alt="License" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey?style=flat" alt="Platform" />
  <a href="https://github.com/SuperTost100/moreopenwhispr/releases/latest"><img src="https://img.shields.io/github/v/release/SuperTost100/moreopenwhispr?style=flat&sort=semver" alt="GitHub release" /></a>
  <a href="https://github.com/SuperTost100/moreopenwhispr/releases"><img src="https://img.shields.io/github/downloads/SuperTost100/moreopenwhispr/total?style=flat&color=blue" alt="Downloads" /></a>
</p>

<p align="center">
  Unofficial fork of <a href="https://github.com/OpenWhispr/openwhispr">OpenWhispr</a>.<br/>
  Press a hotkey, speak, and the text lands at your cursor.<br/>
  Antigravity, your own API keys, or fully local. No OpenWhispr Cloud account.
</p>

<p align="center">
  <a href="https://github.com/SuperTost100/moreopenwhispr/releases/latest">Download</a> &middot;
  <a href="docs/macos.md">macOS</a> &middot;
  <a href="docs/windows.md">Windows</a> &middot;
  <a href="docs/linux.md">Linux</a> &middot;
  <a href="docs/building.md">Build</a> &middot;
  <a href="docs/antigravity.md">Antigravity</a> &middot;
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

MoreOpenWhisperer is the OpenWhispr desktop app with the SaaS layer cut out. Dictation, meetings, notes, calendars, and the voice assistant stay. OpenWhispr Cloud sign-in, Pro upsells, hosted MCP, and telemetry go away. Transcription defaults to your [Antigravity](docs/antigravity.md) subscription (`agy`), or you point it at Whisper, Parakeet, Cohere, or a provider key you already pay for.

Not OpenWhispr. Not Gizmo Labs. Not Google. MIT, same as upstream.

## Download

Unsigned builds. macOS will ask you to right-click → Open the first time. If it says the app is damaged, that is Gatekeeper on an unsigned download, not a broken file: `xattr -cr /Applications/MoreOpenWhisperer.app` then open it again. Windows SmartScreen may warn too. That is expected until a release is signed.

| Platform              | File                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS (Apple Silicon) | [`.dmg`](https://github.com/SuperTost100/moreopenwhispr/releases/latest)                                                                                                                                                                                                                              |
| macOS (Intel) \*      | [`.dmg`](https://github.com/SuperTost100/moreopenwhispr/releases/latest)                                                                                                                                                                                                                              |
| Windows               | [`.exe` installer](https://github.com/SuperTost100/moreopenwhispr/releases/latest) / [portable](https://github.com/SuperTost100/moreopenwhispr/releases/latest)                                                                                                                                           |
| Linux                 | [`.AppImage`](https://github.com/SuperTost100/moreopenwhispr/releases/latest) / [`.deb`](https://github.com/SuperTost100/moreopenwhispr/releases/latest) / [`.rpm`](https://github.com/SuperTost100/moreopenwhispr/releases/latest) / [`.tar.gz`](https://github.com/SuperTost100/moreopenwhispr/releases/latest) |

\* On Intel Macs, live speaker identification and voice fingerprinting are unavailable. ONNX Runtime [stopped shipping macOS x86_64 binaries in 1.24](https://github.com/microsoft/onnxruntime/releases/tag/v1.24.1). Meetings still record and transcribe. Notes search falls back to keyword matching.

No release attached yet? [Build from source](docs/building.md). Tag `v*` on this repo and GitHub Actions packs all four platforms.

Install notes: [macOS](docs/macos.md) · [Windows](docs/windows.md) · [Linux](docs/linux.md)

## What it does

- **Dictation.** Global hotkey. Speak. Text pastes into the focused app. Globe/Fn on a Mac, Control+Super on Windows and Linux, with fallbacks if the OS already owns that combo.
- **Antigravity STT and LLM.** Sign in once with `agy auth login`. Fast dictation goes through Google's Cloud Code gateway. Optional live preview. Cleanup, agent, and chat can ride the same session. [Setup](docs/antigravity.md).
- **BYOK.** OpenAI, Anthropic, Gemini, Groq, OpenRouter, Azure, Bedrock, Tinfoil, Mistral. Keys stay in the OS keychain.
- **Local.** whisper.cpp (Metal / CUDA / Vulkan), NVIDIA Parakeet, Cohere Transcribe, local GGUF models via llama.cpp. Audio never leaves the machine on this path.
- **Meetings.** Detect Zoom, Teams, FaceTime and the rest. Mic plus system audio, speaker labels, calendar link-up (Google, Microsoft, Apple on macOS).
- **Notes.** Local folders, semantic search when Qdrant is running, AI actions on a note. No cloud sync, because there is no cloud account.
- **Voice assistant.** Separate hotkey. No wake word. Answers paste at a verified caret, or open in the floating panel.
- **Translation hotkey.** Dictate in one language, paste in another.
- **Local CLI.** `openwhispr --local …` talks to the running app on 127.0.0.1. Cloud CLI login is gone.

## What this fork drops

These exist on [official OpenWhispr](https://github.com/OpenWhispr/openwhispr) behind Cloud / Pro. They are removed here on purpose:

- OpenWhispr Cloud transcription and sign-in
- Hosted MCP (`mcp.openwhispr.com`)
- `openwhispr auth login` and the rest of cloud CLI
- Account, billing, workspace, referrals, usage analytics, team spaces
- Telemetry (the toggle is gone; it stays off)

|                 | MoreOpenWhisperer           | OpenWhispr                  |
| --------------- | ------------------------ | --------------------------- |
| Cloud account   | Removed                  | Optional free + Pro         |
| STT / LLM       | Antigravity, BYOK, local | Those plus OpenWhispr Cloud |
| MCP / cloud CLI | Removed                  | Pro                         |
| Telemetry       | Off                      | Opt-in toggle               |
| Platforms       | macOS, Windows, Linux    | macOS, Windows, Linux       |

Upstream README is kept at [README.upstream.md](./README.upstream.md).

## Quick start from source

Needs [Node.js 24](https://nodejs.org/) (see `.nvmrc`).

```bash
git clone https://github.com/SuperTost100/moreopenwhispr.git
cd moreopenwhispr
nvm use
npm ci
npm run dev
```

Packaged installers: `npm run build:mac`, `build:win`, or `build:linux`. Full matrix, native helpers, and unsigned-release notes are in [docs/building.md](docs/building.md).

If you want Antigravity as the cloud path, install `agy`, run `agy auth login`, then pick Antigravity during onboarding. [docs/antigravity.md](docs/antigravity.md).

The commands above run the desktop application, which remains at the repository root. The Expo mobile application lives in [`openwhispr-mobile`](openwhispr-mobile/) with its own dependencies, lockfile, build configuration, and release process. See the [mobile README](openwhispr-mobile/README.md) for its setup instructions.

## Documentation

- [macOS](docs/macos.md). Globe key, Gatekeeper, permissions
- [Windows](docs/windows.md). Installer vs portable, SmartScreen, push-to-talk
- [Linux](docs/linux.md). AppImage / deb / rpm, Wayland hotkeys and paste
- [Building](docs/building.md). Every platform, from a git checkout
- [Antigravity](docs/antigravity.md). `agy` login, Fast vs Polished, what Google sees
- [Local Whisper](LOCAL_WHISPER_SETUP.md). Models, GPU packs, cache paths
- [Network allowlist](docs/network-allowlist.md). Firewall / proxy hosts
- [Troubleshooting](TROUBLESHOOTING.md) · [Debug logs](DEBUG.md) · [Security](SECURITY.md)

Repo examples:

- [Custom ASR shim](examples/custom-asr-shim/) for Self-Hosted transcription against APIs that are not OpenAI-shaped

## Tech stack

React 19, TypeScript, Tailwind CSS v4, Electron 41, better-sqlite3, whisper.cpp, sherpa-onnx, llama.cpp, shadcn/ui.

## Contributing

`main` is the shipping branch.

1. Branch off `main`.
2. `nvm use && npm ci && npm run lint && npm test`
3. Open a PR against `main` on [SuperTost100/moreopenwhispr](https://github.com/SuperTost100/moreopenwhispr).

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md), not a public issue.

Fixes that belong in official OpenWhispr should go to [OpenWhispr/openwhispr](https://github.com/OpenWhispr/openwhispr).

## License

[MIT](LICENSE), same grant as upstream. Keep that file with any binary you ship.

Antigravity traffic uses **your** `agy` login and Google's terms. This repo is client software. It is not a Google product and it is not unlimited free Google transcription.

## Acknowledgments

- **[OpenWhispr](https://github.com/OpenWhispr/openwhispr)**, the app this fork starts from
- **[OpenAI Whisper](https://github.com/openai/whisper)** and **[whisper.cpp](https://github.com/ggerganov/whisper.cpp)**
- **[NVIDIA Parakeet](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)** and **[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)**
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)**
- **[Electron](https://www.electronjs.org/)**, **[React](https://react.dev/)**, **[shadcn/ui](https://ui.shadcn.com/)**
