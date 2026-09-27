# The fork line says the app is a fork of itself

Importance: Medium importance

The control panel footer is supposed to name the upstream project. The English string is `Unofficial {{upstreamName}} fork.` and `upstreamName` is `OpenWhispr`.

`src/i18n.ts` runs `rewriteUpstreamBrand` on every translated string when this is a MoreOpenWhisperer build. That function replaces every `OpenWhispr` with `MoreOpenWhisperer`. The interpolated upstream name is replaced too. The line that shows up is `Unofficial MoreOpenWhisperer fork.`

The same three lines sit in the sidebar and in the compact nav. `ControlPanelSidebar.tsx` renders `controlPanel.shell.forkDisclosureUnofficial`.

## What the screenshot shows

Under the compact nav, the disclosure reads: No account required. Unofficial MoreOpenWhisperer fork. Not affiliated with Google.
