# macOS

MoreOpenWhisperer on a Mac lives in the menu bar. It waits for a hotkey and types into whatever you are already using.

## What you need

- macOS 12 Monterey or later
- Apple Silicon or Intel (separate downloads)
- macOS 14.2 or later if you want system audio in meetings

## Install

1. Grab the Apple Silicon or Intel `.dmg` from [Releases](https://github.com/SuperTost100/moreopenwhispr/releases/latest). Apple menu → About This Mac tells you which chip you have.
2. Open the disk image and drag **MoreOpenWhisperer** into Applications. Leave it on the mounted image and odd things happen later.
3. The first launch is unsigned. Finder: right-click the app → **Open** → Open. System Settings → Privacy & Security also has an Open Anyway button if Gatekeeper blocked it. If macOS says the app is **damaged**, that is the same unsigned-download check. In Terminal:

   ```bash
   xattr -cr /Applications/MoreOpenWhisperer.app
   ```

   Then open it from Applications.

Onboarding asks for the permissions below.

## Permissions

Settings → Privacy & Data → System → Permissions. Each card has Grant Access until macOS agrees.

| Permission       | Without it                                                  | macOS pane                            |
| ---------------- | ----------------------------------------------------------- | ------------------------------------- |
| Microphone       | Nothing is captured                                         | Privacy & Security → Microphone       |
| Accessibility    | Auto-paste fails. Text still hits the clipboard             | Privacy & Security → Accessibility    |
| System Audio     | Other people in a meeting are missing. Your mic still works | Privacy & Security → Screen Recording |
| Screen Recording | Voice-assistant screen context (off by default)             | Privacy & Security → Screen Recording |

System Audio is filed under Screen Recording on macOS. The meeting path captures audio, not your display. Screen Recording for the voice assistant is a one-shot JPEG of the display under the cursor. It is not saved.

Replacing the `.app` (update, rebuild, move) often leaves a stale Accessibility row. In the app, Permissions → Troubleshooting → Reset accessibility permissions, then grant it again.

## Hotkey

Default dictation key is Globe / Fn. macOS only. Change it, plus Voice Assistant, Translation, Meeting, and Chat, under Settings → Hotkeys.

## Menu bar and Dock

The tray icon shows the dictation pill or opens Settings. The Dock icon follows the control panel: visible while Settings is open, gone when you close it to the tray. A login launch with "start minimized" shows no Dock icon on purpose.

## Antigravity

Install `agy`, run `agy auth login` in Terminal, then pick Antigravity in onboarding or Settings. Details: [antigravity.md](antigravity.md).

## Updates and uninstall

Builds on this fork are unsigned, so there is no Apple notarized auto-update from Gizmo Labs. Download the next `.dmg` from Releases, or pull git and [build](building.md).

To uninstall:

```bash
rm -rf /Applications/MoreOpenWhisperer.app
rm -rf ~/.cache/openwhispr
rm -rf ~/Library/Application\ Support/MoreOpenWhispr
```

The cache folder still uses the upstream `openwhispr` name. App support data stays in the legacy `MoreOpenWhispr` directory for compatibility.

## Related

- [Building](building.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
- [Debug logs](../DEBUG.md)
