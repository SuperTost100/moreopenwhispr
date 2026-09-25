const test = require("node:test");
const assert = require("node:assert/strict");

const {
  convertJsonSchemaToGeminiSchema,
  buildFunctionDeclarations,
  flattenGeminiContentsToMessages,
} = require("../../src/helpers/antigravityFunctionCalling");

test("convertJsonSchemaToGeminiSchema keeps supported keys and drops unsupported ones", () => {
  const schema = convertJsonSchemaToGeminiSchema({
    type: "object",
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
    default: {},
    description: "Search notes",
    properties: {
      query: { type: "string", description: "search text", default: "" },
      limit: { type: "integer" },
    },
    required: ["query"],
  });

  assert.deepEqual(schema, {
    description: "Search notes",
    properties: {
      query: { type: "string", description: "search text" },
      limit: { type: "integer" },
    },
    required: ["query"],
    type: "object",
  });
  assert.ok(!("additionalProperties" in schema));
  assert.ok(!("$schema" in schema));
  assert.ok(!("default" in schema));
});

test("convertJsonSchemaToGeminiSchema recurses into items for array schemas", () => {
  const schema = convertJsonSchemaToGeminiSchema({
    type: "array",
    items: { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
  });
  assert.deepEqual(schema, {
    type: "array",
    items: { type: "object", properties: { id: { type: "string" } } },
  });
});

test("convertJsonSchemaToGeminiSchema falls back to a permissive object schema for garbage input", () => {
  assert.deepEqual(convertJsonSchemaToGeminiSchema(null), { type: "object" });
  assert.deepEqual(convertJsonSchemaToGeminiSchema("nope"), { type: "object" });
});

test("buildFunctionDeclarations converts the app's tool list into Gemini functionDeclarations", () => {
  const declarations = buildFunctionDeclarations([
    {
      name: "search_notes",
      description: "Search notes",
      parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    },
    { name: "no_description" },
    { name: "" }, // dropped: no usable name
  ]);
  assert.equal(declarations.length, 2);
  assert.equal(declarations[0].name, "search_notes");
  assert.equal(declarations[0].parameters.type, "object");
  assert.equal(declarations[1].name, "no_description");
  assert.equal(declarations[1].description, "");
});

test("flattenGeminiContentsToMessages maps model -> assistant and renders tool parts as text markers", () => {
  const messages = flattenGeminiContentsToMessages([
    { role: "user", parts: [{ text: "search my notes for revenue" }] },
    {
      role: "model",
      parts: [{ functionCall: { name: "search_notes", args: { query: "revenue" } } }],
    },
    {
      role: "user",
      parts: [{ functionResponse: { name: "search_notes", response: { result: "found 2 notes" } } }],
    },
    { role: "model", parts: [{ text: "Found 2 notes about revenue." }] },
  ]);

  assert.deepEqual(messages, [
    { role: "user", content: "search my notes for revenue" },
    { role: "assistant", content: '[tool_call search_notes {"query":"revenue"}]' },
    { role: "user", content: '[tool_result search_notes {"result":"found 2 notes"}]' },
    { role: "assistant", content: "Found 2 notes about revenue." },
  ]);
});

test("flattenGeminiContentsToMessages drops turns that render to no text and marks inline images", () => {
  const messages = flattenGeminiContentsToMessages([
    { role: "user", parts: [] },
    { role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: "abc" } }] },
  ]);
  assert.deepEqual(messages, [{ role: "user", content: "[image attached]" }]);
});
