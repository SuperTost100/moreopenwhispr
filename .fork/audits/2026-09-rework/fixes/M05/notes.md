Status: FIXED NOW

Root cause:
`ControlPanelCompactNav.tsx` picked the trigger label with
`navItems.find((item) => item.id === activeView) ?? navItems[0]`. Settings is
a real view (`ControlPanelView`) but has no entry in `CONTROL_PANEL_NAV_ITEMS`
(it has its own dedicated button, not a slot in the view switcher). So when
Settings was open, the `.find()` always missed and the code fell back to
`navItems[0]`, which is Home / "sidebar.dictation". Below 800px the compact
trigger showed "Dictation" while the page underneath was Settings.

The unused helper `getControlPanelNavLabelKey` in `controlPanelNavModel.ts`
had the identical bug (same `?? "sidebar.dictation"` fallback), pinned by a
test that literally asserted an unknown view falls back to "sidebar.dictation".

Fix:
- `getControlPanelNavLabelKey` now returns `sidebar.settings` for the
  `"settings"` view explicitly, and falls back to `common.unknown` (not
  `sidebar.dictation`) for a view id that matches nothing, so a real bug can
  never masquerade as "Dictation" again.
- `ControlPanelCompactNav.tsx` now calls that function for the label, and
  resolves the trigger icon the same way (Settings icon for the settings view,
  otherwise looked up in `CONTROL_PANEL_NAV_ITEMS` directly instead of via the
  policy-filtered `navItems`).

Files changed:
- src/components/control-panel/controlPanelNavModel.ts
- src/components/control-panel/ControlPanelCompactNav.tsx
- test/components/controlPanelNavModel.test.js (updated the stale fallback
  assertion, added a settings-view assertion)

Test: test/components/controlPanelNavModel.test.js
Command: node --import tsx --test test/components/controlPanelNavModel.test.js
before.txt / after.txt in this folder.

Screenshots: mow-work/audit-fix/M05/before.png and after.png, both a 720x800
control panel with Settings open. before.png: trigger reads "Dictation" with
the home icon while the page underneath is Settings. after.png: trigger reads
"Settings" with the gear icon, matching the page. Captured with
mow-work/shots/m05-compact-nav-capture.mjs (new script; reuses the
isolated-profile + control-panel-remount helpers from shots.mjs, opens
Settings via the wide sidebar's footer button, then resizes to 720px so the
compact nav takes over with Settings already open, matching the audit's
"opened from the gear button, then narrow" repro).

Commit: b459f484 "Fix compact nav trigger mislabeling Settings as Dictation"
