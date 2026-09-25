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
  const contents = buildInitialContents(
    [{ role: "user", content: "what's on my screen?" }],
    { data: "abc123", mediaType: "image/png" }
  );
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

// --- runAntigravityChatStream loop ---------------------------------------------------

test("runAntigravityChatStream executes each distinct valid call once, skips a duplicate id and an invalid call, then finishes on text", async (t) => {
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
  assert.ok("error" in responseTurn.parts[1].functionResponse.response);
  assert.ok("error" in responseTurn.parts[2].functionResponse.response);
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
