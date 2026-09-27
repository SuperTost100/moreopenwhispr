Status: FIXED NOW

Root cause:
`CompactPermissionsStep.tsx` capped the first-run title at `max-w-72` (288px)
with `text-balance`, sized for the upstream English string "Set up OpenWhispr
in 3 minutes" wrapping to two lines. On a MOW build the resource string is
brand-rewritten to "Set up MoreOpenWhisperer in 3 minutes" (see M07 for how
that rewrite happens). "MoreOpenWhisperer" alone is wider than the 288px cap
at the compact canvas's 26px/text-3xl title size, so the browser has to give
it its own line, and "Set up" and "in 3 minutes" each end up on their own
line too: three lines total instead of two, at the onboarding window's
native 480x624 compact size (src/helpers/windowConfig.js
ONBOARDING_WINDOW_SIZES.COMPACT).

The comment directly above the heading described the intended break as
"Set up OpenWhispr" / "in 3 minutes" — stale for the MOW build and for the
actual wrap once the cap forced three lines.

The DEV-only `onboarding.permissions.electronDevHint` paragraph, shown below
the permission rows, was clipped at the bottom of the 624px-tall window
(`.onboarding-shell-scroll` hides its scrollbar with `scrollbar-width: none`
/ `::-webkit-scrollbar { display: none }`, so the overflow was invisible and
unreachable). This only affects a dev build (`import.meta.env.DEV`), but the
underlying cause was the same: the extra title line ate ~36px of the 624px
budget that the rest of the content needed.

Fix:
Removed the `mx-auto max-w-72` cap on the `<h1>` (kept `text-balance` and the
`text-3xl!` size). The flex-column parent (`flex h-full flex-col`) already
stretches a block child to the full content width by default, so the
heading now uses the whole available width instead of an upstream-sized cap.
At that width "Set up MoreOpenWhisperer" and "in 3 minutes" both fit their
own line, restoring the two-line layout — and freeing that ~36px also makes
the dev hint fit inside the 624px window without needing to scroll, so no
separate scroll-affordance fix was needed. Updated the stale comment to not
name a specific two-line break (correct in all locales, not just English).

Verified in English (2 lines: "Set up MoreOpenWhisperer" / "in 3 minutes")
and German (2 lines: "MoreOpenWhisperer" / "in 3 Minuten einrichten") at
480x624, both with the dev hint fully visible. Screenshots:
mow-work/audit-fix/M08/before.png (English, three-line title + hint sliced at
the bottom edge) and after.png (English, two lines + full hint visible).

Files changed:
- src/components/onboarding/CompactPermissionsStep.tsx

Test: test/components/compactPermissionsStep.test.js
Command: node --test test/components/compactPermissionsStep.test.js
before.txt / after.txt in this folder. The test pins the structural root
cause (no max-w-* utility narrower than the container on the title heading);
actual line-count/clipping is confirmed visually via the screenshots, since
node:test has no layout engine to measure real text wrapping.

Screenshot harness: mow-work/shots/m08-permissions-capture.mjs (new script,
modeled on shots.mjs's isolated-profile launch pattern; launches a fresh
guest profile, which lands on the "permissions" step at its native 480x624
size, with --lang for a locale pass).

Commit: 600efe65 "Let the first-run title use its full width instead of an upstream-sized cap"
