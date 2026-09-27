Status: ALREADY FIXED

Root cause (as audited): on the old architecture, `runAntigravityChatStream` only
forwarded `screenContext` to the model when `tools` was empty. A tool turn went
through `processAntigravityToolTurn`, which never received the image and instead
appended a text placeholder ("[Screen context was attached to this request]...").

What fixed it: commit 0d8ecaf1 ("Move the assistant chat tool loop onto the
Antigravity gateway") replaced the per-turn `agy --print` tool loop with native
Gemini function calling over the gateway. The tools and no-tools paths now share
one content-builder, `buildInitialContents(messages, screenContext)`
(src/services/ai/antigravityChat.ts), which always attaches the screenshot as an
`inlineData` part on the first user turn regardless of whether `tools` is
non-empty. The placeholder sentence ("Screen context was attached to this
request...") no longer exists anywhere in src/.

Last-resort failover: when the gateway is unreachable, `runAntigravityChatTurn`
(src/helpers/antigravityChatGateway.js) falls back to the `agy` CLI subprocess
via `subprocessChatTurn`, which flattens the Gemini `contents` to plain
{role, content} text turns for the CLI's older interface
(src/helpers/antigravityFunctionCalling.js, `flattenGeminiContentsToMessages` /
`describeGeminiPart`). That flattening renders an `inlineData` part as the text
marker `"[image attached]"` and drops the bytes. This is intentional and
documented (comment above `describeGeminiPart`) and is covered by an existing
test (test/helpers/antigravityFunctionCalling.test.js:96-98). Per the brief,
this is acceptable only for that narrow, already-unreachable-gateway fallback
path — the primary gateway path (used for every normal turn) always sends the
real bytes.

Files changed: none (already fixed on HEAD). Added a regression test:
test/services/antigravityChat.test.js — "runAntigravityChatStream attaches the
screenshot as inlineData bytes on a turn with tools, never a placeholder
sentence". Also separately covered pre-existing: the agy-subprocess drop is
pinned by test/helpers/antigravityFunctionCalling.test.js.

Test command: `node --import tsx --test test/services/antigravityChat.test.js`

Commit that fixed it: 0d8ecaf1 (already on HEAD 47356a06, no new fix commit
needed for this finding).
