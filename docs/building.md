# Building MoreOpenWhisperer

Node.js **24** only (`.nvmrc`). CI uses 24. Do not regenerate `package-lock.json` with another major.

```bash
git clone https://github.com/SuperTost100/moreopenwhispr.git
cd openwhispr
git checkout antigravity-fork
nvm use
npm ci
```

`npm ci` rebuilds native addons (`better-sqlite3`, `onnxruntime-node`, …) for the machine you are on. Cross-packaging from one OS to another is what GitHub Actions is for.

## Development

```bash
npm run dev
```

That compiles platform helpers, downloads sidecar binaries (whisper.cpp, sherpa-onnx, Qdrant, …) on first run, then starts Electron plus Vite.

Useful checks:

```bash
npm test
npm run lint
npm run typecheck
npm run i18n:check
```

## Native helpers

`npm run compile:native` builds whatever this OS can compile (Swift on macOS, the Windows C helpers only on Windows, PipeWire helper only on Linux). Packaging scripts call the ones they need.

| Script | Platform |
| --- | --- |
| `compile:globe`, `compile:fast-paste`, `compile:mic-listener`, `compile:calendar-listener`, `compile:audio-tap`, `compile:media-remote` | macOS |
| `compile:winkeys`, `compile:winpaste` | Windows (or download prebuilts) |
| `compile:linuxkeys`, `compile:linux-paste`, `compile:linux-system-audio` | Linux |

Windows CI compiles `windows-mic-listener.exe` with MSVC and downloads the other helpers from GitHub releases.

## Packaged builds (this machine)

Unsigned. `electron-builder.json` has no Apple identity and no Azure Trusted Signing.

| You are on | Command | Output |
| --- | --- | --- |
| macOS | `npm run build:mac` | `dist/` `.dmg` + `.zip` (host arch). `build:mac:arm64` / `build:mac:x64` to pin |
| Windows | `npm run build:win` | NSIS `.exe` + portable `.exe` |
| Linux | `npm run build:linux` | AppImage, deb, rpm, tar.gz |

Finer Linux targets: `build:linux:appimage`, `build:linux:deb`, `build:linux:rpm`, `build:linux:tar`.

Dir-only unpackaged tree (macOS example):

```bash
npm run pack
# dist/mac-arm64/MoreOpenWhisperer.app
```

`prebuild:*` downloads whisper.cpp, llama-server, sherpa-onnx, Qdrant, yt-dlp, meeting AEC, diarization models. Set `GITHUB_TOKEN` if GitHub rate-limits you.

```bash
export GITHUB_TOKEN=ghp_...   # optional
npm run download:whisper-cpp
npm run download:whisper-cpp:all   # every OS, for a release machine
```

### macOS notes

- Unsigned app: right-click → Open. Notarization is off.
- Apple Silicon vs Intel are separate artifacts. Building x64 on Apple Silicon needs the x64 ffmpeg-static binary (`npm_config_arch=x64` on that package, as CI does).
- `npm run compile:mac-icon` runs from `prebuild:mac`.

### Windows notes

- Needs MSVC or the prebuilt helpers (`download:windows-key-listener`, `download:windows-mic-listener`, `download:windows-system-audio-helper`, `download:nircmd`, `download:windows-fast-paste`).
- No Authenticode. SmartScreen will complain.

### Linux notes

- `build:linux` wants `rpm` tooling plus X11/XTest/AT-SPI/PipeWire headers for the native helpers. Ubuntu example: `sudo apt-get install rpm libx11-dev libxtst-dev libatspi2.0-dev libglib2.0-dev libpipewire-0.3-dev pkg-config`
- After compile, `resources/bin/linux-system-audio-helper probe` should report `supportsNativeCapture: true` if PipeWire linked.

## Release all platforms (GitHub Actions)

You cannot produce a trustworthy Windows NSIS and a Linux deb from a Mac in one local command. The [Release](../.github/workflows/release.yml) workflow does:

- Linux x64 (ubuntu-latest): AppImage, deb, rpm, tar.gz
- Windows x64 (windows-latest): NSIS + portable
- macOS arm64 and x64 (macos-latest): dmg + zip

Tag must match `package.json` `version`:

```bash
# version is currently 1.9.3
git tag v1.9.3
git push fork v1.9.3
```

Or Actions → Release → Run workflow → version `1.9.3`.

Artifacts upload to [GitHub Releases](https://github.com/SuperTost100/moreopenwhispr/releases) as drafts (`electron-builder.json` `releaseType: draft`). Publish the draft when you have clicked through Gatekeeper/SmartScreen once yourself.

`GITHUB_TOKEN` is enough. Apple and Azure signing secrets are not used. Optional `.env` calendar client IDs (`GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `MICROSOFT_CALENDAR_CLIENT_ID`) can be repo secrets if you want packaged calendar OAuth. Empty means those buttons stay unconfigured.

Manual full pack without a tag: Actions → Build and Notarize → Run workflow. Name is leftover from upstream. Builds are unsigned.

## Side-by-side with official OpenWhispr

| | MoreOpenWhisperer | OpenWhispr |
| --- | --- | --- |
| Bundle id | `com.moreopenwhispr.app` | upstream id |
| App name | MoreOpenWhisperer | OpenWhispr |
| Windows AppUserModelId | `com.moreopenwhispr.app` | `com.gizmolabs.openwhispr` |
| userData | `MoreOpenWhispr` (legacy MOW directory) | `OpenWhispr` |
| Model cache | `~/.cache/openwhispr/` (shared) | same folder |

They can both be installed. They share the model cache on purpose.

## Related

- [macOS](macos.md) · [Windows](windows.md) · [Linux](linux.md)
- [Local Whisper](../LOCAL_WHISPER_SETUP.md)
- Maintainer notes: [.fork/ANTIGRAVITY.md](../.fork/ANTIGRAVITY.md), [.fork/COMPLIANCE.md](../.fork/COMPLIANCE.md)
