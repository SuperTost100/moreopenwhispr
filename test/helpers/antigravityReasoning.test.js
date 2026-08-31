const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildReasoningPrompt,
  parseToolLoopResponse,
} = require("../../src/helpers/antigravityReasoning");

test("buildReasoningPrompt combines system and user sections", () => {
  const prompt = buildReasoningPrompt({
    systemPrompt: "Clean up dictation. OUTPUT RULES: return only cleaned text.",
    userText: "um hello world",
  });

  assert.match(prompt, /^SYSTEM:\nClean up dictation/);
  assert.match(prompt, /USER:\num hello world/);
  assert.match(prompt, /Output only the answer\./);
});

test("parseToolLoopResponse accepts a final JSON payload", () => {
  const parsed = parseToolLoopResponse(
    JSON.stringify({ type: "final", content: "Hello there." })
  );
  assert.deepEqual(parsed, { type: "final", content: "Hello there." });
});

test("parseToolLoopResponse accepts a tool_call JSON payload", () => {
  const parsed = parseToolLoopResponse(
    JSON.stringify({
      type: "tool_call",
      tool_call: { name: "search_notes", arguments: { query: "revenue" } },
    })
  );
  assert.equal(parsed.type, "tool_call");
  assert.deepEqual(parsed.tool_call, {
    name: "search_notes",
    arguments: { query: "revenue" },
  });
});

test("parseToolLoopResponse strips markdown fences", () => {
  const parsed = parseToolLoopResponse(
    '```json\n{"type":"final","content":"done"}\n```'
  );
  assert.deepEqual(parsed, { type: "final", content: "done" });
});

test("parseToolLoopResponse coerces final-with-tool-json into tool_call", () => {
  const parsed = parseToolLoopResponse(
    JSON.stringify({
      type: "final",
      content: JSON.stringify({
        name: "search_notes",
        arguments: { query: "revenue" },
      }),
    })
  );
  assert.equal(parsed.type, "tool_call");
  assert.equal(parsed.tool_call.name, "search_notes");
  assert.deepEqual(parsed.tool_call.arguments, { query: "revenue" });
});
