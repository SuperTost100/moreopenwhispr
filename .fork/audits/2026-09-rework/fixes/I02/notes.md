Status: ALREADY FIXED

Root cause (as audited): on the old architecture, `cancelActiveStream` aborted
the controller, but `runAntigravityChatStream` only checked the abort signal at
the top of the per-turn loop, before calling `processAntigravityToolTurn`. The
IPC payload carried no abort signal at all, and the response was not
re-checked against the signal after it came back, so a `tool_call` result went
straight to `executeToolCall` even if cancel happened while the call was in
flight.

What fixed it: commit b9ac5337 ("Close the gaps an independent review found in
the Antigravity transport") and the earlier gateway rewrite (0d8ecaf1) added:
  1. A `requestId` sent with every `processAntigravityChatTurn` IPC call, plus
     `api.cancelAntigravityRequest(requestId)` wired to the abort signal — so
     cancel reaches the specific in-flight main-process operation, not just a
     local flag checked after the fact.
  2. An explicit recheck of `abortSignal?.aborted` immediately after every
     `await api.processAntigravityChatTurn(...)` (and after
     `api.processAntigravityReasoning(...)` on the no-tools path), before any
     functionCalls are touched or yielded.
  3. A recheck before each individual tool execution inside the per-turn loop
     (`for (const call of functionCalls) { ... if (abortSignal?.aborted)
     return; ... }`), so a multi-call turn stops between calls too.
(src/services/ai/antigravityChat.ts)

This means: a response that resolves after abort — even one carrying a
create_note functionCall — is discarded before `executeToolCall` is ever
called, and a turn with multiple calls stops after the call in flight when
cancel lands between calls.

Files changed: none (already fixed on HEAD). Added two regression tests to
test/services/antigravityChat.test.js:
  - "runAntigravityChatStream never executes a tool call whose gateway turn
    resolved after the signal was aborted" (abort while the gateway turn is
    pending, response carries a create_note functionCall — asserts
    executeToolCall is never called and no chunks are yielded).
  - The pre-existing "runAntigravityChatStream stops executing remaining calls
    in a turn once cancelled mid-turn" already covered the multi-call case
    (abort raised by the first call's own execution, second call never runs).

Test command: `node --import tsx --test test/services/antigravityChat.test.js`

Commit that fixed it: b9ac5337 (already on HEAD 47356a06, no new fix commit
needed for this finding).
