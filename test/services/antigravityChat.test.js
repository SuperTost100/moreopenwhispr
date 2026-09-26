const test = require("node:test");
const assert = require("node:assert/strict");

function loadModule() {
  return import("../../src/services/ai/antigravityChat.ts");
}

function withWindow(t, electronAPI) {
  const originalWindow = globalThis.window;
  globalThis.window = { electronAPI };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
}

// --- buildInitialContents ---------------------------------------------------

test("buildInitialContents attaches a screenshot to the first user turn", async () => {
  const { buildInitialContents } = await loadModule();
  const contents = buildInitialContents([{ role: "user", content: "what's on my screen?" }], {
    data: "abc123",
    mediaType: "image/png",
  });
  assert.equal(contents.length, 1);
  assert.equal(contents[0].role, "user");
  assert.deepEqual(contents[0].parts[1], { inlineData: { mimeType: "image/png", data: "abc123" } });
});

test("buildInitialContents adds a leading user turn for a screenshot when there is no prior user turn", async () => {
  const { buildInitialContents } = await loadModule();
  const contents = buildInitialContents([], { data: "xyz", mediaType: "image/jpeg" });
  assert.equal(contents.length, 1);
  assert.deepEqual(contents[0], {
    role: "user",
    parts: [{ inlineData: { mimeType: "image/jpeg", data: "xyz" } }],
  });
});

test("buildInitialContents maps assistant history to the model role", async () => {
  const { buildInitialContents } = await loadModule();
  const contents = buildInitialContents([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  assert.deepEqual(contents, [
    { role: "user", parts: [{ text: "hi" }] },
    { role: "model", parts: [{ text: "hello" }] },
  ]);
});

// --- validateToolArguments ---------------------------------------------------

test("validateToolArguments flags a missing required field", async () => {
  const { validateToolArguments } = await loadModule();
  const result = validateToolArguments(
    { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    {}
  );
  assert.equal(result.valid, false);
  assert.match(result.error, /query/);
});

test("validateToolArguments flags a type mismatch", async () => {
  const { validateToolArguments } = await loadModule();
  const result = validateToolArguments(
    { type: "object", properties: { limit: { type: "integer" } } },
    { limit: "five" }
  );
  assert.equal(result.valid, false);
});

test("validateToolArguments accepts a valid call and a schema-less tool", async () => {
  const { validateToolArguments } = await loadModule();
  assert.equal(
    validateToolArguments(
      { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      { query: "revenue" }
    ).valid,
    true
  );
  assert.equal(validateToolArguments(undefined, { anything: true }).valid, true);
});

// --- dedupeKeyForCall ---------------------------------------------------

test("dedupeKeyForCall prefers the call id, else hashes name+args independent of key order", async () => {
  const { dedupeKeyForCall } = await loadModule();
  assert.equal(dedupeKeyForCall({ name: "x", args: {}, id: "call-1" }), "call-1");
  const a = dedupeKeyForCall({ name: "search_notes", args: { query: "a", limit: 5 } });
  const b = dedupeKeyForCall({ name: "search_notes", args: { limit: 5, query: "a" } });
  assert.equal(a, b);
  const c = dedupeKeyForCall({ name: "search_notes", args: { query: "b", limit: 5 } });
  assert.notEqual(a, c);
});

// --- screen context reaches the request even when tools are offered --------

// rework-audit/important/01-assistant-drops-screenshot-when-tools-are-on:
// on the old `agy --print`-per-turn architecture, a tool turn sent a text
// placeholder ("[Screen context was attached to this request]...") instead
// of the screenshot bytes. The gateway rewrite replaced that per-turn CLI
// call with buildInitialContents(), which is shared by both the tools and
// no-tools paths and always attaches the screenshot as inlineData — this
// pins that a tool turn's IPC payload carries the real bytes, not a
// placeholder sentence.
test("runAntigravityChatStream attaches the screenshot as inlineData bytes on a turn with tools, never a placeholder sentence", async (t) => {
  const receivedContents = [];
  withWindow(t, {
    processAntigravityChatTurn: async (payload) => {
      receivedContents.push(payload.contents);
      return { success: true, textParts: [{ text: "I can see it." }], functionCalls: [] };
    },
  });

  const { runAntigravityChatStream } = await loadModule();
  const stream = runAntigravityChatStream({
    systemPrompt: "sys",
    messages: [{ role: "user", content: "what's on my screen?" }],
    tools: [{ name: "create_note", description: "create a note", parameters: { type: "object" } }],
    model: "gemini-3-flash",
    executeToolCall: async () => ({ data: "", displayText: "" }),
    screenContext: { data: "QUJDRA==", mediaType: "image/jpeg" },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);

  assert.equal(receivedContents.length, 1);
  const sentText = JSON.stringify(receivedContents[0]);
  const imagePart = receivedContents[0]
    .flatMap((turn) => turn.parts)
    .find((part) => part.inlineData);
  assert.ok(imagePart, "the tool-turn request must carry an inlineData image part");
  assert.equal(imagePart.inlineData.data, "QUJDRA==");
  assert.equal(imagePart.inlineData.mimeType, "image/jpeg");
  assert.ok(
    !sentText.includes("Screen context was attached"),
    "the placeholder sentence must not stand in for the image bytes on a tool turn"
  );
  assert.equal(chunks.find((c) => c.type === "content")?.text, "I can see it.");
});

// --- runAntigravityChatStream loop ---------------------------------------------------

test("runAntigravityChatStream executes each distinct valid call once, returns the cached result for a duplicate id, and finishes on text", async (t) => {
  const turnResponses = [
    {
      success: true,
      textParts: [],
      functionCalls: [
        { name: "search_notes", args: { query: "revenue" }, id: "c1" },
        { name: "search_notes", args: { query: "revenue" }, id: "c1" }, // duplicate id
        { name: "search_notes", args: {}, id: "c2" }, // missing required "query"
      ],
    },
    { success: true, textParts: [{ text: "Found it." }], functionCalls: [] },
  ];
  const receivedContents = [];
  let turn = 0;
  withWindow(t, {
    processAntigravityChatTurn: async (payload) => {
      receivedContents.push(payload.contents);
      return turnResponses[turn++];
    },
  });

  const { runAntigravityChatStream } = await loadModule();
  const executed = [];
  const chunks = [];
  const stream = runAntigravityChatStream({
    systemPrompt: "sys",
    messages: [{ role: "user", content: "search my notes" }],
    tools: [
      {
        name: "search_notes",
        description: "search",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ],
    model: "gemini-3-flash",
    executeToolCall: async (name, argsJson) => {
      executed.push({ name, argsJson });
      return { data: "note-1", displayText: "1 note found" };
    },
  });
  for await (const chunk of stream) chunks.push(chunk);

  assert.equal(executed.length, 1);
  assert.equal(executed[0].name, "search_notes");
  assert.equal(chunks.at(-1).type, "done");
  assert.equal(chunks.find((c) => c.type === "content")?.text, "Found it.");

  const responseTurn = receivedContents[1].at(-1);
  assert.equal(responseTurn.role, "user");
  assert.equal(responseTurn.parts.length, 3);
  assert.ok("result" in responseTurn.parts[0].functionResponse.response);
  // A repeated call id returns the cached result from the first execution
  // without re-executing — not an error (see the invocation-wide
  // executedById cache: `executed.length` above stays 1).
  assert.deepEqual(
    responseTurn.parts[1].functionResponse.response,
    responseTurn.parts[0].functionResponse.response
  );
  assert.ok("error" in responseTurn.parts[2].functionResponse.response);
});

// rework-audit/important/02-cancel-still-runs-assistant-tools: aborting
// while the gateway turn (processAntigravityChatTurn) is still pending used
// to let a returned tool_call run anyway, since the signal was only checked
// before the call went out. The recheck right after the IPC await (before
// touching functionCalls) must make a create_note call that races the abort
// never reach executeToolCall.
test("runAntigravityChatStream never executes a tool call whose gateway turn resolved after the signal was aborted", async (t) => {
  const controller = new AbortController();
  const executed = [];
  withWindow(t, {
    processAntigravityChatTurn: async () => {
      controller.abort(); // abort lands while this "request" is in flight
      return {
        success: true,
        textParts: [],
        functionCalls: [{ name: "create_note", args: { title: "should never be created" }, id: "c1" }],
      };
    },
  });

  const { runAntigravityChatStream } = await loadModule();
  const chunks = [];
  const stream = runAntigravityChatStream({
    systemPrompt: "",
    messages: [{ role: "user", content: "make a note" }],
    tools: [{ name: "create_note", description: "", parameters: { type: "object" } }],
    model: "m",
    executeToolCall: async (name, argsJson) => {
      executed.push({ name, argsJson });
      return { data: "note-created", displayText: "created" };
    },
    abortSignal: controller.signal,
  });
  for await (const chunk of stream) chunks.push(chunk);

  assert.deepEqual(executed, [], "a tool call must never run once the signal aborted before it was seen");
  assert.deepEqual(chunks, [], "no chunks — including tool_calls — may be yielded after an abort");
});

test("runAntigravityChatStream stops executing remaining calls in a turn once cancelled mid-turn", async (t) => {
  const controller = new AbortController();
  const executed = [];
  withWindow(t, {
    processAntigravityChatTurn: async () => ({
      success: true,
      textParts: [],
      functionCalls: [
        { name: "a", args: {}, id: "1" },
        { name: "b", args: {}, id: "2" },
      ],
    }),
  });

  const { runAntigravityChatStream } = await loadModule();
  const stream = runAntigravityChatStream({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }],
    tools: [
      { name: "a", description: "", parameters: { type: "object" } },
      { name: "b", description: "", parameters: { type: "object" } },
    ],
    model: "m",
    executeToolCall: async (name) => {
      executed.push(name);
      controller.abort(); // cancel lands between the first and second call
      return { data: "ok", displayText: "ok" };
    },
    abortSignal: controller.signal,
  });
  for await (const _chunk of stream) {
    // drain
  }
  assert.deepEqual(executed, ["a"]);
});

test("runAntigravityChatStream returns the cached result for a call id repeated on a later turn, without re-executing", async (t) => {
  // Regression: seenKeys used to be recreated per turn, so a call id
  // repeated on turn 2 (e.g. the model re-issuing an id from turn 1) would
  // execute again — e.g. a repeated create_note id creating a second note.
  const turnResponses = [
    {
      success: true,
      textParts: [],
      functionCalls: [{ name: "create_note", args: { title: "a" }, id: "dup-id" }],
    },
    {
      success: true,
      textParts: [],
      // Same id resurfaces on the next turn.
      functionCalls: [{ name: "create_note", args: { title: "a" }, id: "dup-id" }],
    },
    { success: true, textParts: [{ text: "done" }], functionCalls: [] },
  ];
  let turn = 0;
  withWindow(t, {
    processAntigravityChatTurn: async () => turnResponses[turn++],
  });

  const { runAntigravityChatStream } = await loadModule();
  const executed = [];
  const stream = runAntigravityChatStream({
    systemPrompt: "",
    messages: [{ role: "user", content: "make a note" }],
    tools: [{ name: "create_note", description: "", parameters: { type: "object" } }],
    model: "m",
    executeToolCall: async (name) => {
      executed.push(name);
      return { data: "note-created", displayText: "created" };
    },
  });
  for await (const _chunk of stream) {
    // drain
  }
  assert.deepEqual(executed, ["create_note"], "the second turn's repeated id must not re-execute");
});

test("runAntigravityChatStream wires the abortSignal to cancel the specific in-flight main-process request", async (t) => {
  const cancelledRequestIds = [];
  let sentRequestId = null;
  const controller = new AbortController();
  withWindow(t, {
    processAntigravityChatTurn: async (payload) => {
      sentRequestId = payload.requestId;
      controller.abort();
      return { success: true, textParts: [{ text: "should never be seen" }], functionCalls: [] };
    },
    cancelAntigravityRequest: (requestId) => {
      cancelledRequestIds.push(requestId);
    },
  });

  const { runAntigravityChatStream } = await loadModule();
  const chunks = [];
  const stream = runAntigravityChatStream({
    systemPrompt: "",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "a", description: "", parameters: { type: "object" } }],
    model: "m",
    abortSignal: controller.signal,
  });
  for await (const chunk of stream) chunks.push(chunk);

  assert.ok(sentRequestId, "a requestId must be sent with the chat-turn payload");
  assert.deepEqual(
    cancelledRequestIds,
    [sentRequestId],
    "abort must send cancelAntigravityRequest with the same requestId the turn used"
  );
  // Recheck-after-IPC: a response that raced the abort must yield nothing.
  assert.deepEqual(chunks, []);
});

test("runAntigravityChatStream throws once it exceeds the max tool-loop iterations", async (t) => {
  withWindow(t, {
    processAntigravityChatTurn: async () => ({
      success: true,
      textParts: [],
      functionCalls: [{ name: "loop", args: {}, id: "loop-call" }],
    }),
  });

  const { runAntigravityChatStream } = await loadModule();
  const stream = runAntigravityChatStream({
    systemPrompt: "",
    messages: [{ role: "user", content: "go" }],
    tools: [{ name: "loop", description: "", parameters: { type: "object" } }],
    model: "m",
    executeToolCall: async () => ({ data: "x", displayText: "x" }),
  });

  await assert.rejects(async () => {
    for await (const _chunk of stream) {
      // drain
    }
  }, /maximum turns/);
});
