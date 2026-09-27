Status: FIXED NOW

Root cause:
`src/i18n.ts` ran `rewriteUpstreamBrand` (src/config/mowProfile.ts) as an
i18next `postProcess` step, which runs on the fully interpolated string
returned by `t()`. `rewriteUpstreamBrand` does `replaceAll("OpenWhispr",
"MoreOpenWhisperer")`. The English resource for the fork disclosure is
`"Unofficial {{upstreamName}} fork."` (no literal "OpenWhispr" in the
resource itself); `ControlPanelSidebar.tsx` and `ControlPanelCompactNav.tsx`
call `t("controlPanel.shell.forkDisclosureUnofficial", { upstreamName:
MOW_PROFILE.upstreamName })` where `upstreamName` is literally "OpenWhispr".
i18next interpolates that value into the string before the postProcess step
runs, so the postProcess step then rewrote the interpolated "OpenWhispr" too,
producing "Unofficial MoreOpenWhisperer fork." — the fork claiming to be an
unofficial fork of itself.

Fix:
Moved the brand rewrite from a postProcess step (runs after interpolation) to
a one-time deep rewrite of the translation/prompt resource objects at load,
before `i18n.init()`. `rewriteResourceStrings()` walks the resource tree and
calls `rewriteUpstreamBrand` on every string leaf. Resource strings that
contain a hardcoded "OpenWhispr" (e.g. `tray.tooltip`, onboarding titles)
still get rewritten exactly as before. Resource strings that only contain the
`{{upstreamName}}` placeholder are untouched by the rewrite (no literal
"OpenWhispr" to replace in the resource), and since postProcess no longer
runs, the interpolated value substituted in later is never touched either.

Checked prompts namespace and other postProcess reliance: PROMPTS_BY_LOCALE
(system prompts sent to the LLM) has no "OpenWhispr" mentions, and nothing in
the app currently calls i18next.t() with an interpolation value that itself
contains "OpenWhispr" other than the fork-disclosure calls, so nothing else
depended on the old postProcess rewriting an interpolated value. Confirmed
all 11 locale files use the same `{{upstreamName}}` placeholder pattern for
`forkDisclosureUnofficial` (none hardcode "OpenWhispr" as literal text).

Note: `src/helpers/i18nMain.js` (main process i18n, used for tray/dialog
copy) has the same postProcess pattern, but no `i18nMain.t()` call site in
main-process code interpolates a value containing "OpenWhispr", so it is not
exhibiting this bug today. Left unchanged; out of scope for this finding, but
worth the same fix if a future dialog string interpolates an upstream name.

Files changed:
- src/i18n.ts (resources -> rawResources, added rewriteResourceStrings(),
  dropped the mowBrand postProcessor and the postProcess option)

Test: test/locales/i18nBrandRewrite.test.js
Command: node --test test/locales/i18nBrandRewrite.test.js
before.txt / after.txt in this folder show the exact claim from the brief:
`t("controlPanel.shell.forkDisclosureUnofficial", { upstreamName: "OpenWhispr" })`
yields "Unofficial OpenWhispr fork." after the fix (was "Unofficial
MoreOpenWhisperer fork." before), while a plain hardcoded "OpenWhispr" string
(tray.tooltip) is still rewritten to the fork's product name.

Screenshots: mow-work/audit-fix/M07/before.png and after.png, the control
panel's fork disclosure line under the compact nav. before.png: "Unofficial
MoreOpenWhisperer fork." after.png: "Unofficial OpenWhispr fork." Captured
with mow-work/shots/m05-compact-nav-capture.mjs (same script used for M05;
the disclosure line is visible in the same crop).

Commit: 51d3d5a6 "Stop the fork disclosure line renaming its own upstream project"
