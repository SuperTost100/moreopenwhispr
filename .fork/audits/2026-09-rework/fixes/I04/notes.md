I04 - paste focuses the app and switches Spaces

Status: FIXED NOW

## Root cause (three parts, all reproduced on HEAD before the fix)

1. src/helpers/textEditMonitor.js `_activateApp` called `activateWithOptions(3)`
   (NSApplicationActivateAllWindows | NSApplicationActivateIgnoringOtherApps) and
   never excluded this app's own pid. Activating our own process with AllWindows
   raises every window we own, including the control panel, which sits on its
   own Space.

2. `captureTargetPid()` clears `lastTargetPid` to null and starts an async
   osascript lookup (`_readFrontmostPid`, reading `NSWorkspace.frontmostApplication`).
   The hotkey handlers in main.js call this and then immediately call
   `showDictationPanel()` without waiting for the lookup. Nothing stopped the
   lookup from later resolving to our own pid (if focus had shifted to us by
   the time it finished) and storing it as the paste target.

3. main.js `app.on("activate")` showed and focused the control panel window
   whenever any BrowserWindow existed, with no check for what caused the
   activate event. If our own app got activated (via bug 1+2), this handler
   was the thing that actually pulled the control panel forward and caused
   the Space switch.

## Fix

- `textEditMonitor.js`:
  - Added `_ownPids()` (process.pid + electron `app.getAppMetrics()` pids).
  - `captureTargetPid()` now discards a resolved pid that is our own and
    stores `null` instead, so a late lookup can never make us the paste
    target (fixes cause 2).
  - `_activateApp` now calls `activateWithOptions(2)`
    (NSApplicationActivateIgnoringOtherApps only, not AllWindows), so even a
    legitimate target app's other-Space windows aren't dragged forward
    (fixes cause 1).
  - `activatePid()` now also short-circuits to `false` for our own pid as a
    last line of defense before running the osascript at all.
- `src/helpers/dockPolicy.js`: added a pure `resolveActivateAction({ windowCount, programmaticActivation })`
  returning `"recreate" | "show-control-panel" | "noop"`. `"noop"` when the
  activation was ours; otherwise identical to the previous behavior (recreate
  windows when none exist, else show+focus the control panel).
- `main.js`: `app.on("activate")` now calls `resolveActivateAction` and does
  nothing when it returns `"noop"`. Everything else (recreate windows, show +
  focus control panel, `enforceMainWindowOnTop`) is unchanged for a real Dock
  click.
- `src/helpers/windowManager.js`: added `_programmaticActivation` flag with
  `beginProgrammaticActivation()` / `endProgrammaticActivation()` /
  `isProgrammaticActivation()`.
- `src/helpers/ipcHandlers.js`: the `paste-text` handler now brackets
  `textEditMonitor.activateTargetPid()` with begin/end programmatic
  activation, so if that call ever activates a process (should never be our
  own pid after the textEditMonitor fix, but this is defense in depth), the
  main.js activate handler ignores it instead of raising the control panel.

## Files changed

- src/helpers/textEditMonitor.js
- src/helpers/dockPolicy.js
- src/helpers/windowManager.js
- src/helpers/ipcHandlers.js
- main.js
- test/helpers/textEditMonitorCaptureTarget.test.js (new tests)
- test/helpers/textEditMonitorSelection.test.js (new tests)
- test/helpers/dockPolicy.test.js (new tests)

## Tests

Command: `node --test test/helpers/textEditMonitorCaptureTarget.test.js test/helpers/textEditMonitorSelection.test.js test/helpers/dockPolicy.test.js`

New tests added:
- "a capture never stores our own pid as the paste target"
- "a late lookup resolving to our own pid cannot overwrite the target"
- "activatePid never activates our own pid"
- "the activation script uses IgnoringOtherApps only, never AllWindows"
- "a programmatic activation never shows the control panel"
- "a real Dock click with no visible windows recreates them"
- "a real Dock click with windows already open shows the control panel"

before.txt: reverted src/helpers/textEditMonitor.js and src/helpers/dockPolicy.js
to HEAD (git show HEAD:<path>) and ran the same test command. 7 of 31 tests
fail, matching the three causes above (own pid stored/activated,
activateWithOptions(3) still used, resolveActivateAction missing).

after.txt: same command with the fix in place. 31/31 pass.

typecheck: `npm run typecheck` passes clean with the fix applied.

## What could only be verified by hand

The actual macOS Space switch cannot be reproduced in a headless test run (no
real desktop Spaces, no real other running apps, no real focus changes). The
fix removes the code paths that cause it (self-activation with AllWindows,
storing our own pid as a target, and the activate handler raising the control
panel for a self-triggered activation), and the tests pin those specific
mechanisms, but the end-to-end "does the Space actually change" behavior
needs a manual check.

Manual check (3 steps):
1. Put a text editor (e.g. TextEdit) on Space 1 and OpenWhispr's control panel
   on a different Space (Space 2). Switch to Space 1 so the editor has focus
   and is frontmost.
2. Trigger dictation with the global hotkey, speak a short phrase, and let it
   finish transcribing so the app pastes the result.
3. Confirm you stay on Space 1 the whole time (macOS never switches to Space 2)
   and the transcribed text lands in the editor, not the control panel.
