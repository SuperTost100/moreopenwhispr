const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  streamChatTurn,
  _setUserDataDirForTests,
  _resetProjectIdCacheForTests,
} = require("../../src/helpers/antigravityGateway");
const { runAntigravityChatTurn } = require("../../src/helpers/antigravityChatGateway");
const { _resetCatalogForTests } = require("../../src/helpers/antigravityModelCatalog");
const { createAntigravityOperation } = require("../../src/helpers/antigravityOperation");

let sandboxUserDataDir;
test.before(() => {
  sandboxUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-chatgateway-userdata-"));
  _setUserDataDirForTests(sandboxUserDataDir);
});
test.after(() => {
  _setUserDataDirForTests(null);
  fs.rmSync(sandboxUserDataDir, { recursive: true, force: true });
});

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

async function withServer(handler, run) {
  const { server, url } = await startServer(handler);
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function sseBody(lines) {
  return lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("");
}

function candidateChunk(parts, finishReason) {
  const candidate = { content: { parts } };
  if (finishReason) candidate.finishReason = finishReason;
  return { response: { candidates: [candidate] } };
}

function jsonHandler(routes) {
  return (req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const route = Object.keys(routes).find((key) => req.url.includes(key));
      routes[route](req, res, raw);
    });
  };
}

// --- streamChatTurn: request shape + response parsing -----------------------

test("streamChatTurn sends tools/toolConfig/contents and parses a recorded-shape SSE with two functionCall parts plus a thought part", async () => {
  let capturedBody;
  await withServer(
    jsonHandler({
      streamGenerateContent: (req, res, raw) => {
        capturedBody = JSON.parse(raw);
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          sseBody([
            candidateChunk([{ thought: true, text: "reasoning about which tool to call" }]),
            candidateChunk([
              {
                functionCall: { name: "search_notes", args: { query: "revenue" }, id: "call-1" },
                thoughtSignature: "sig-a",
              },
              {
                functionCall: { name: "get_time", args: {} },
                thoughtSignature: "sig-b",
              },
            ]),
          ]) + sseBody([candidateChunk([], "STOP")])
        );
      },
    }),
    async (base) => {
      const contents = [
        { role: "user", parts: [{ text: "search my notes and tell me the time" }] },
      ];
      const functionDeclarations = [
        { name: "search_notes", description: "Search notes", parameters: { type: "object" } },
        { name: "get_time", description: "Current time", parameters: { type: "object" } },
      ];
      const result = await streamChatTurn({
        accessToken: "tok",
        base,
        projectId: "proj-1",
        model: "gemini-3-flash",
        systemInstruction: { parts: [{ text: "You are an assistant." }] },
        contents,
        functionDeclarations,
        fetchImpl: fetch,
      });

      assert.equal(result.functionCalls.length, 2);
      assert.deepEqual(result.functionCalls[0], {
        name: "search_notes",
        args: { query: "revenue" },
        thoughtSignature: "sig-a",
        id: "call-1",
      });
      assert.equal(result.functionCalls[1].name, "get_time");
      assert.equal(result.functionCalls[1].thoughtSignature, "sig-b");
      assert.equal(result.textParts.length, 0); // the thought part never becomes a text part
      assert.equal(result.finishReason, "STOP");

      assert.deepEqual(capturedBody.request.contents, contents);
      assert.deepEqual(capturedBody.request.tools, [{ functionDeclarations }]);
      assert.deepEqual(capturedBody.request.toolConfig, {
        functionCallingConfig: { mode: "AUTO" },
      });
      assert.equal(capturedBody.request.systemInstruction.parts[0].text, "You are an assistant.");
      assert.equal(capturedBody.request.generationConfig.thinkingConfig.thinkingLevel, "low");
      assert.equal(capturedBody.model, "gemini-3-flash");
    }
  );
});

test("streamChatTurn returns text-only when the model answers without calling a tool", async () => {
  await withServer(
    jsonHandler({
      streamGenerateContent: (req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([candidateChunk([{ text: "Hello there." }], "STOP")]));
      },
    }),
    async (base) => {
      const result = await streamChatTurn({
        accessToken: "tok",
        base,
        projectId: "proj-1",
        model: "gemini-3-flash",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        functionDeclarations: [],
        fetchImpl: fetch,
      });
      assert.equal(result.functionCalls.length, 0);
      assert.equal(result.textParts[0].text, "Hello there.");
    }
  );
});

test("streamChatTurn does not throw AGY_EMPTY_OUTPUT for a functionCall-only response with no text", async () => {
  await withServer(
    jsonHandler({
      streamGenerateContent: (req, res) => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          sseBody([candidateChunk([{ functionCall: { name: "get_time", args: {} } }], "STOP")])
        );
      },
    }),
    async (base) => {
      const result = await streamChatTurn({
        accessToken: "tok",
        base,
        projectId: "proj-1",
        model: "gemini-3-flash",
        contents: [{ role: "user", parts: [{ text: "what time is it" }] }],
        functionDeclarations: [
          { name: "get_time", description: "", parameters: { type: "object" } },
        ],
        fetchImpl: fetch,
      });
      assert.equal(result.functionCalls.length, 1);
      assert.equal(result.textParts.length, 0);
    }
  );
});

// --- runAntigravityChatTurn: failover + subprocess fallback ------------------

test("runAntigravityChatTurn fails over to the next candidate model on a 500 and succeeds", async (t) => {
  _resetCatalogForTests();
  _resetProjectIdCacheForTests();
  const modelsCalled = [];
  await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        const body = JSON.parse(raw);
        modelsCalled.push(body.model);
        if (body.model === "gemini-3.8-flash-tiered") {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "internal error" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([candidateChunk([{ text: "ok from fallback model" }], "STOP")]));
      });
    },
    async (base) => {
      const catalog = require("../../src/helpers/antigravityModelCatalog");
      t.mock.method(catalog, "getCatalog", () => ({
        models: {
          "gemini-3.8-flash-tiered": { supportsImages: true, supportedMimeTypes: {} },
          "gemini-3.5-flash-lite": { supportsImages: true, supportedMimeTypes: {} },
        },
        tieredModelIds: {
          flash: ["gemini-3.8-flash-tiered"],
          flashLite: ["gemini-3.5-flash-lite"],
          pro: [],
        },
        deprecatedModelIds: {},
      }));

      const op = createAntigravityOperation({ budgetMs: 20_000, label: "test" });
      const result = await runAntigravityChatTurn({
        systemPrompt: "sys",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        fetchImpl: fetch,
        getAccessToken: async () => ({ accessToken: "tok", accountKey: "acct" }),
        getProjectId: async () => "proj-1",
        gatewayBase: base,
        op,
      });

      assert.equal(result.textParts[0].text, "ok from fallback model");
      assert.ok(modelsCalled.length >= 2);
    }
  );
});

test("runAntigravityChatTurn routes to the agy CLI subprocess leg when the gateway is network-unreachable, never a gateway model id", async () => {
  _resetCatalogForTests();
  _resetProjectIdCacheForTests();
  const catalog = require("../../src/helpers/antigravityModelCatalog");
  const originalGetCatalog = catalog.getCatalog;
  catalog.getCatalog = () => ({
    models: { "gemini-2.5-flash-lite": { supportsImages: false, supportedMimeTypes: {} } },
    tieredModelIds: { flash: [], flashLite: ["gemini-2.5-flash-lite"], pro: [] },
    deprecatedModelIds: {},
  });

  const op = createAntigravityOperation({ budgetMs: 20_000, label: "test" });
  try {
    await assert.rejects(
      runAntigravityChatTurn({
        systemPrompt: "sys",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        fetchImpl: async () => {
          throw new Error("should never reach fetch: getProjectId already failed");
        },
        getAccessToken: async () => ({ accessToken: "tok", accountKey: "acct" }),
        getProjectId: async () => {
          // Network-unreachable per isNetworkUnreachableError (ENOTFOUND code).
          throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
        },
        op,
        // runToolLoopTurn spawns the real agy CLI by default; point it at a
        // command that can't resolve so this only proves the subprocess leg
        // was reached (AGY_NOT_FOUND), not that a real agy install answered.
        command: "/nonexistent/agy-fake-binary-for-tests",
      }),
      (error) => error.code === "AGY_NOT_FOUND"
    );
  } finally {
    catalog.getCatalog = originalGetCatalog;
  }
});

test("runAntigravityChatTurn surfaces AGY_RATE_LIMITED with a reset time when every chat candidate (including the pinned fallback) is cooling, never calling the gateway", async () => {
  // Regression: the pinned fallback used to be pushed unconditionally, so
  // this situation could never actually happen — candidates always had at
  // least the pinned model, which then got retried even though it was
  // already known to be unavailable.
  _resetCatalogForTests();
  _resetProjectIdCacheForTests();
  const catalog = require("../../src/helpers/antigravityModelCatalog");
  const originalGetCatalog = catalog.getCatalog;
  catalog.getCatalog = () => ({
    models: {
      "gemini-3.8-flash-tiered": { supportsImages: false, supportedMimeTypes: {} },
      "gemini-2.5-flash-lite": { supportsImages: false, supportedMimeTypes: {} },
    },
    tieredModelIds: { flash: ["gemini-3.8-flash-tiered"], flashLite: [], pro: [] },
    deprecatedModelIds: {},
  });
  const resetAt = Date.now() + 5 * 60_000;
  catalog.markModelCooldown("gemini-3.8-flash-tiered", resetAt);
  catalog.markModelCooldown("gemini-2.5-flash-lite", resetAt);

  const op = createAntigravityOperation({ budgetMs: 20_000, label: "test" });
  let fetchCalled = false;
  try {
    await assert.rejects(
      runAntigravityChatTurn({
        systemPrompt: "sys",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [],
        fetchImpl: async () => {
          fetchCalled = true;
          throw new Error("must never reach the gateway with zero candidates");
        },
        getAccessToken: async () => ({ accessToken: "tok", accountKey: "acct" }),
        getProjectId: async () => "proj-1",
        op,
      }),
      (error) => {
        assert.equal(error.code, "AGY_RATE_LIMITED");
        assert.equal(error.scope, "account");
        assert.ok(Number.isFinite(error.retryAfterMs) && error.retryAfterMs > 0);
        return true;
      }
    );
    assert.equal(fetchCalled, false);
  } finally {
    catalog.getCatalog = originalGetCatalog;
    catalog.clearModelCooldowns();
  }
});

// rework-audit/medium/01-missing-model-reported-as-rate-limit: on the old
// two-host retry loop, exhausting every candidate for a 404'd model rewrote
// the failure to a hardcoded HTTP 429, which the renderer showed as a
// rate-limit toast. The gateway (src/helpers/antigravityGateway.js) now
// throws AGY_MODEL_UNAVAILABLE with the real 404 status per attempt
// (asserted directly against generateContent in antigravityGateway.test.js);
// this pins the same guarantee one level up, once every chat candidate model
// has been asked and all of them 404 — the error that reaches the renderer
// must still be the real 404/not-found shape, never AGY_RATE_LIMITED/429.
test("runAntigravityChatTurn surfaces a 404 as AGY_MODEL_UNAVAILABLE with status 404 once every candidate model has been tried, never a rate-limit error", async (t) => {
  _resetCatalogForTests();
  _resetProjectIdCacheForTests();
  const modelsCalled = [];
  await withServer(
    (req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        const body = JSON.parse(raw);
        modelsCalled.push(body.model);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: `models/${body.model} is not found` } }));
      });
    },
    async (base) => {
      const catalog = require("../../src/helpers/antigravityModelCatalog");
      t.mock.method(catalog, "getCatalog", () => ({
        models: {
          "gemini-3.8-flash-tiered": { supportsImages: true, supportedMimeTypes: {} },
          "gemini-3.5-flash-lite": { supportsImages: true, supportedMimeTypes: {} },
        },
        tieredModelIds: {
          flash: ["gemini-3.8-flash-tiered"],
          flashLite: ["gemini-3.5-flash-lite"],
          pro: [],
        },
        deprecatedModelIds: {},
      }));

      const op = createAntigravityOperation({ budgetMs: 20_000, label: "test" });
      await assert.rejects(
        runAntigravityChatTurn({
          systemPrompt: "sys",
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
          tools: [],
          fetchImpl: fetch,
          getAccessToken: async () => ({ accessToken: "tok", accountKey: "acct" }),
          getProjectId: async () => "proj-1",
          gatewayBase: base,
          op,
        }),
        (error) => {
          assert.equal(error.code, "AGY_MODEL_UNAVAILABLE");
          assert.equal(error.status, 404);
          assert.match(error.message, /is not found/);
          return true;
        }
      );
      assert.ok(modelsCalled.length >= 2, "every candidate model must have been tried");
    }
  );
});
