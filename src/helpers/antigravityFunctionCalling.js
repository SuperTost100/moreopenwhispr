// Pure, Electron-free helpers for Phase B: converting the app's JSON-Schema
// tool definitions into the Gemini "OpenAPI subset" functionDeclarations
// shape, and flattening a Gemini-shaped `contents` history back into plain
// {role, content} text turns for the agy CLI subprocess fallback (which has
// no native function-calling support of its own).
"use strict";

// Keys Gemini's functionDeclarations schema accepts. Anything else (notably
// additionalProperties, $schema, default — all valid JSON Schema but
// rejected or ignored by Gemini) is dropped rather than sent and risking a
// 400.
const GEMINI_SCHEMA_KEYS = ["type", "properties", "required", "enum", "description", "items"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * convertJsonSchemaToGeminiSchema(schema) -> Gemini OpenAPI-subset schema
 *
 * Recursively keeps only type/properties/required/enum/description/items,
 * recursing into `properties` values and `items`. Non-object/garbage input
 * becomes `{ type: "object" }` so a malformed tool schema still produces a
 * valid (if permissive) Gemini schema instead of throwing.
 */
function convertJsonSchemaToGeminiSchema(schema) {
  if (!isPlainObject(schema)) {
    return { type: "object" };
  }
  const out = {};
  for (const key of GEMINI_SCHEMA_KEYS) {
    if (!(key in schema)) continue;
    if (key === "properties" && isPlainObject(schema.properties)) {
      const props = {};
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        props[propName] = convertJsonSchemaToGeminiSchema(propSchema);
      }
      out.properties = props;
    } else if (key === "items") {
      out.items = convertJsonSchemaToGeminiSchema(schema.items);
    } else if (key === "required") {
      if (Array.isArray(schema.required)) {
        out.required = schema.required.filter((name) => typeof name === "string");
      }
    } else if (key === "enum") {
      if (Array.isArray(schema.enum)) out.enum = schema.enum;
    } else {
      out[key] = schema[key];
    }
  }
  if (!out.type) out.type = isPlainObject(out.properties) ? "object" : "string";
  return out;
}

/**
 * buildFunctionDeclarations(tools) -> Gemini functionDeclarations array
 * `tools` is the app's AntigravityToolSchema[] ({ name, description, parameters }).
 */
function buildFunctionDeclarations(tools = []) {
  return tools
    .filter((tool) => tool && typeof tool.name === "string" && tool.name.trim())
    .map((tool) => ({
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: convertJsonSchemaToGeminiSchema(tool.parameters),
    }));
}

function describeGeminiPart(part) {
  if (!part || typeof part !== "object") return "";
  if (typeof part.text === "string") return part.text;
  if (part.functionCall) {
    return `[tool_call ${part.functionCall.name} ${JSON.stringify(part.functionCall.args || {})}]`;
  }
  if (part.functionResponse) {
    return `[tool_result ${part.functionResponse.name} ${JSON.stringify(
      part.functionResponse.response || {}
    )}]`;
  }
  if (part.inlineData) return "[image attached]";
  return "";
}

/**
 * flattenGeminiContentsToMessages(contents) -> [{ role: "user"|"assistant", content }]
 *
 * Adapter for the agy CLI subprocess fallback, which only understands the
 * older plain-text {role, content} turn shape. `model` role maps to
 * "assistant"; functionCall/functionResponse parts are rendered as bracketed
 * text markers rather than dropped, so the CLI still sees that a tool ran.
 */
function flattenGeminiContentsToMessages(contents = []) {
  return contents
    .map((turn) => {
      const role = turn?.role === "model" ? "assistant" : "user";
      const content = (Array.isArray(turn?.parts) ? turn.parts : [])
        .map(describeGeminiPart)
        .filter(Boolean)
        .join("\n");
      return { role, content };
    })
    .filter((message) => message.content);
}

module.exports = {
  convertJsonSchemaToGeminiSchema,
  buildFunctionDeclarations,
  flattenGeminiContentsToMessages,
};
