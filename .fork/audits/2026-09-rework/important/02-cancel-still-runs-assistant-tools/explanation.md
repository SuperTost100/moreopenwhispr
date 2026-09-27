# Stopping the assistant still runs the tool

Importance: Important

Esc or Stop aborts the Antigravity chat signal, but the turn that is already in flight still comes back and still runs its tool. A cancelled request can create or change a note after the user has stopped it.

`cancelActiveStream` in `src/services/ReasoningService.ts` calls `abort()` on the controller. `runAntigravityChatStream` in `src/services/ai/antigravityChat.ts` checks that signal only at the top of the loop, before `processAntigravityToolTurn`. The IPC payload has no abort signal. When the response arrives, the function does not look at the signal again. A `tool_call` result goes straight to `executeToolCall`.

## What the run showed

The signal was aborted while the tool turn was still waiting. After the response was released, `executeToolCall` ran `create_note`. `toolRanAfterAbort` was true, and the first chunk type was `tool_calls`.
