# The first-run title wraps to three lines and the dev hint is cut off

Importance: Medium importance

The permissions step is the first screen of a MoreOpenWhisperer install. The English source string is `Set up OpenWhispr in 3 minutes`. The brand rewriter turns that into `Set up MoreOpenWhisperer in 3 minutes`. The heading is capped at `max-w-72` in `CompactPermissionsStep.tsx`, and the comment above it still describes a two-line break, `Set up OpenWhispr` and `in 3 minutes`.

On a 480 by 624 content window, the heading is three lines. The h1 box runs from y 176 to y 284, which is 108px, three times the 36px line height.

The development-only hint, `onboarding.permissions.electronDevHint`, starts at y 619 and ends at y 667. The window is 624px tall, so 43px of that paragraph is past the bottom edge. `onboarding-shell-scroll` hides the scrollbar. The hint is shown only when `import.meta.env.DEV` is set, so a packaged build does not render that paragraph. The three-line title is what a packaged build still shows.

## What the screenshot shows

`clipped.png` is that 480 by 624 window. The title is three lines. The grey development hint is sliced along the bottom edge.
