# Linux

64-bit x86_64. No ARM build. Behaviour depends on X11 vs Wayland and on which desktop you run.

## What you need

- PulseAudio or PipeWire for the microphone. PipeWire is also what meeting system audio uses
- A 64-bit distro that can run an Electron 41 app (glibc, not musl/Alpine)

## Which package

From [Releases](https://github.com/SuperTost100/moreopenwhispr/releases/latest):

| Format | For |
| --- | --- |
| `.deb` | Debian, Ubuntu, Mint, Pop!_OS |
| `.rpm` | Fedora, RHEL, openSUSE |
| `.AppImage` | Anything, no root |
| `.tar.gz` | Manual unpack |

There is no OpenWhispr Cloud sign-in in this fork, so the official "browser sign-in only on deb/rpm" warning does not apply. Calendar OAuth uses a localhost loopback server on all formats.

### deb

```bash
sudo apt install ./MoreOpenWhisperer-*-linux-x64.deb
```

### rpm

```bash
sudo dnf install ./MoreOpenWhisperer-*-linux-x64.rpm
```

### AppImage

```bash
chmod +x MoreOpenWhisperer-*.AppImage
./MoreOpenWhisperer-*.AppImage
```

### tar.gz

```bash
tar -xzf MoreOpenWhisperer-*-linux-*.tar.gz
cd MoreOpenWhisperer-*/
./open-whispr
```

The linux executable name stays `open-whispr` (electron-builder `name`). The product name in the UI is MoreOpenWhisperer.

## Microphone

No OS-level app permission. Pick the right source in `pavucontrol` or your desktop's sound settings.

## Paste

Transcription always lands on the clipboard. Injecting it into the focused window is compositor-specific.

A native `linux-fast-paste` helper is tried first (XTest; also covers XWayland apps). On Wayland it wants `/dev/uinput`:

```bash
sudo usermod -aG input $USER
```

Log out and back in.

Fallbacks:

| Session | Tools |
| --- | --- |
| X11 | native helper, then `xdotool` |
| Hyprland | `wtype`, then `hyprctl dispatch sendshortcut`, then uinput / `ydotool` |
| Sway / other wlroots | `wtype`, then uinput / `ydotool` |
| GNOME / KDE Wayland | RemoteDesktop portal keysyms, then uinput / `ydotool` |

Physical Wayland fallbacks use Shift+Insert so the paste is not layout-tied to KEY_V. Install `wl-clipboard` so Wayland apps can actually read what Electron copied.

```bash
# Debian/Ubuntu
sudo apt install wl-clipboard xdotool wtype ydotool
# Fedora
sudo dnf install wl-clipboard xdotool wtype ydotool
# Arch
sudo pacman -S wl-clipboard xdotool wtype ydotool
```

`ydotool` needs the `ydotoold` daemon. First GNOME/KDE portal paste can show a remote-desktop prompt; the token is stored under `~/.cache/openwhispr/portal-paste-token`.

If nothing can inject keys, the app says so and you paste yourself. That is a fallback, not a crash.

## Hotkeys

Default dictation combo is Control+Super. Electron `globalShortcut` does not work on Wayland, so the app registers through the desktop instead.

| Desktop | How |
| --- | --- |
| GNOME + Wayland | Custom shortcut via gsettings / D-Bus (`com.openwhispr.App`). Visible under Settings → Keyboard → Shortcuts → Custom. Tap only, no hold-to-talk |
| KDE Plasma | KGlobalAccel over D-Bus |
| Hyprland | `hyprctl keyword bind` at runtime. Re-applied on launch. Session-only unless Hyprland keeps it |
| X11 | Electron `globalShortcut` |

Hold-to-talk on Linux needs the same `input` group as the paste helper. Until then, dictation stays tap-to-toggle.

## System audio (meetings)

PipeWire default-sink monitor. No screen-share picker. If you expected one, its absence is correct.

```bash
# Debian/Ubuntu
sudo apt install pipewire libpipewire-0.3-0
# Fedora
sudo dnf install pipewire pipewire-libs
```

The user PipeWire session must be running. Sign out after installing packages.

## Launch at login

Settings can write `~/.config/autostart/open-whispr.desktop`. Electron's own login-item API is a no-op on Linux, so this is a real XDG file. GNOME Tweaks or KDE's autostart editor setting `Hidden=true` or `X-GNOME-Autostart-enabled=false` is honored. AppImage entries point at `$APPIMAGE`, not the FUSE mount.

## Antigravity

`agy` on PATH, `agy auth login`, then start the app. [antigravity.md](antigravity.md).

## App data

| What | Path |
| --- | --- |
| Settings, logs, keys | `~/.config/MoreOpenWhispr` |
| Models | `~/.cache/openwhispr/` |
| Autostart | `~/.config/autostart/open-whispr.desktop` |

## Uninstall

Remove the package you installed, or delete the AppImage. For a clean slate:

```bash
rm -rf ~/.config/MoreOpenWhispr ~/.cache/openwhispr ~/.config/autostart/open-whispr.desktop
```

deb/rpm uninstall scripts may already wipe the model cache.

## Related

- [Building](building.md)
- [Troubleshooting](../TROUBLESHOOTING.md)
- [Debug logs](../DEBUG.md)
