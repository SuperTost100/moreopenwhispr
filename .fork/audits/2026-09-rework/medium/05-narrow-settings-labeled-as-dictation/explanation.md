# A narrow window says Dictation while Settings is open

Importance: Medium importance

Below 800px the sidebar is replaced by the compact nav in `ControlPanel.tsx`. Settings is a real view, but it is not one of `CONTROL_PANEL_NAV_ITEMS` in `src/components/control-panel/controlPanelNavModel.ts`. `ControlPanelCompactNav` looks up the active view in that list and, on a miss, uses the first item. The first item is Dictation.

The page underneath is Settings. The menu trigger still reads Dictation.

## What the screenshot shows

The window content size was 720 by 800. Settings was opened from the gear button. The trigger label was `Dictation`. The body of the page was the Settings view, on Preferences.
