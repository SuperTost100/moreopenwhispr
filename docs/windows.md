# Windows

MoreOpenWhisperer runs from the system tray. Press the hotkey, speak, and the text pastes into the focused window.

## What you need

- Windows 10 2004 or later (11 is fine)
- 64-bit x64. There is no ARM64 installer yet
- WASAPI loopback for meeting system audio (built in on those Windows versions)

## Install

From [Releases](https://github.com/SuperTost100/moreopenwhispr/releases/latest):

| File | Use |
| --- | --- |
| NSIS `.exe` | Normal install, Start Menu shortcut, optional install directory |
| Portable `.exe` | No installer. Put it somewhere writable and run it |

The build is not Authenticode-signed. SmartScreen may say "Windows protected your PC". More info → Run anyway. Defender sometimes quarantines bundled whisper.cpp or FFmpeg. Add the install folder to Virus & threat protection → Exclusions if transcription dies immediately.

First launch asks for microphone access: Settings → Privacy → Microphone.

## Hotkey and push-to-talk

Default dictation combo is Control+Super (Control+Win). If that is taken, the app falls back to F8/F9 and tells you.

Hold-to-talk uses a native low-level keyboard hook (`windows-key-listener.exe`). Compound shortcuts like `Ctrl+Shift+F11` work. If that helper is missing, dictation stays tap-to-toggle.

## Meetings

System audio comes from `windows-system-audio-helper.exe` (WASAPI process loopback). It hears every app on every output device and skips MoreOpenWhisperer's own process tree. No extra permission prompt.

If the helper is silent while speakers are clearly playing, the app switches that recording to Chromium loopback after a few seconds. Chromium loopback only hears the **default** output device.

## Antigravity

`agy` must be on PATH for the signed-in user. A GUI session does not see a PATH you only set in a developer PowerShell profile. Install the CLI, run `agy auth login`, then start MoreOpenWhisperer. [antigravity.md](antigravity.md).

## Firewall

The first local Parakeet run may prompt for `sherpa-onnx-ws-win32-x64`. The server only needs `127.0.0.1`. Allow or deny; loopback still works. All-users NSIS installs add a rule that blocks outside access and hides the prompt.

## App data

| What | Path |
| --- | --- |
| Settings, logs, keys | `%APPDATA%\MoreOpenWhispr` |
| Whisper / Parakeet models | `%USERPROFILE%\.cache\openwhispr\` |

Taskbar grouping uses AppUserModelId `com.moreopenwhispr.app`, so this install does not merge with official OpenWhispr.

## Uninstall

Use Apps & features for the NSIS build. Then, for a clean slate:

```bat
rd /s /q "%APPDATA%\MoreOpenWhispr"
rd /s /q "%USERPROFILE%\.cache\openwhispr"
```

## Related

- [Building](building.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
- [Debug logs](../DEBUG.md)
