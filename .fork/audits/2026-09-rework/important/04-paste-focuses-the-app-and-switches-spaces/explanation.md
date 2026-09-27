# Paste focuses the app and switches Spaces

Importance: Important

Dictation paste on macOS activates a process and brings every window of that process forward. When the stored process is this app, that set includes the control panel. The control panel is a normal window, and it does not appear on every Space. macOS switches to the virtual desktop where that window sits. The paste keystroke is then delivered to the app that activation just brought forward.

`paste-text` in `src/helpers/ipcHandlers.js` calls `textEditMonitor.activateTargetPid()` before it pastes. `activatePid` in `src/helpers/textEditMonitor.js` calls `_activateApp`. The script there runs `activateWithOptions(3)`. That value is all windows combined with ignoring other apps. The function does not skip this app's own pid.

The pid is whatever `captureTargetPid` stored. That method clears `lastTargetPid` and starts an osascript lookup. Hotkey handling calls `showDictationPanel` without waiting for the lookup. `_sendDictationToggle` in `src/helpers/windowManager.js` does this, and the macOS hotkey handlers in `main.js` do the same. The value written later is the app that is frontmost when the lookup finishes. Paste then activates that pid.

The dictation pill is a panel, not focusable, and visible on all workspaces. The control panel is not. `CONTROL_PANEL_CONFIG` sets `type` to `normal` and `visibleOnAllWorkspaces` to false.

`app.on("activate")` in `main.js` is a second path to the same window. When any window already exists, the handler calls `controlPanelWindow.show()` and `controlPanelWindow.focus()`. It does not check that the Dock was clicked. Showing and focusing that normal window moves the user to its Space.

## What the run showed

The paste target was pid 5150. Another app, pid 2200, was frontmost. `activateTargetPid` still ran the activation script once. The script matched `processIdentifier === 5150` and called `activateWithOptions(3)`. The activate function does not mention `process.pid` or `getOwnProcessPids`.

A capture was started, and the show-panel step ran while `lastTargetPid` was null. The lookup then stored 5150.

The loaded window config reported the control panel as type `normal` with `visibleOnAllWorkspaces` false, and the dictation window as type `panel`, `focusable` false, `visibleOnAllWorkspaces` true.

The activate handler source contains both `controlPanelWindow.show()` and `controlPanelWindow.focus()`, and it does not read an event or a reason.
