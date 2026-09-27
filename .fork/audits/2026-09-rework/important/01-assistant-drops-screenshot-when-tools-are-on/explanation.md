# Assistant with tools never receives the screenshot

Importance: Important

Share screen context is on, and the voice assistant still answers as if it cannot see the display, whenever the turn is allowed to use tools. Notes, calendar, and the rest of the assistant tools take that path. The screenshot is kept only for a turn that has no tools at all.

`runAntigravityChatStream` in `src/services/ai/antigravityChat.ts` forwards `screenContext` to `processAntigravityReasoning` when `tools` is empty. When `tools` has entries, the image is not included in `processAntigravityToolTurn`. The user message gains this line instead:

`[Screen context was attached to this request. Use it if the question refers to what is on screen.]`

The bytes of the JPEG are not in that request.

## What the run showed

A turn with no tools sent the image. `hasImage` was true and `imageBytes` was 8.

A turn with a `create_note` tool sent no `screenContext` field. The payload did not contain the image bytes `QUJDRA`. It did contain the placeholder sentence above.
