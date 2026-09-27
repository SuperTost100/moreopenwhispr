const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  generateContent,
  transcribeAudioViaGateway,
  generateTextViaGateway,
  getAntigravityProjectId,
  extractResponseText,
  resolveBackendModel,
  isModelRetirementNotice,
  classifyRateLimitScope,
  extractRetryAfterMs,
  DEFAULT_STT_BACKEND_MODEL,
  _setUserDataDirForTests,
  _resetProjectIdCacheForTests,
} = require("../../src/helpers/antigravityGateway");

// Sandbox the persisted project-id cache for the whole file: getAntigravityProjectId
// writes a real userData-relative file, and without an override it would land in
// the real OS temp dir and leak state across test runs (and across other suites).
let sandboxUserDataDir;
before(() => {
  sandboxUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-gateway-userdata-"));
  _setUserDataDirForTests(sandboxUserDataDir);
});
after(() => {
  _setUserDataDirForTests(null);
  fs.rmSync(sandboxUserDataDir, { recursive: true, force: true });
});

// --- pure helpers ----------------------------------------------------------

test("extractResponseText reads candidate parts and skips thought parts", () => {
  const text = extractResponseText({
    response: {
      candidates: [
        {
          content: {
            parts: [{ thought: true, text: "thinking about it..." }, { text: "hello world" }],
          },
        },
      ],
    },
  });
  assert.equal(text, "hello world");
});

test("resolveBackendModel pins empty/synthetic transcribe ids to the known-good default", () => {
  assert.equal(resolveBackendModel(""), DEFAULT_STT_BACKEND_MODEL);
  assert.equal(resolveBackendModel("gemini-3.5-transcribe"), DEFAULT_STT_BACKEND_MODEL);
  assert.equal(resolveBackendModel("gemini-3.5-transcribe-live"), DEFAULT_STT_BACKEND_MODEL);
  assert.equal(resolveBackendModel("gemini-3.8-flash-tiered"), "gemini-3.8-flash-tiered");
});

test("transcribeAudioViaGateway puts the caller's resolved model in the request body", async () => {
  // The Antigravity backend-model picker (AntigravitySettingsPanel) offers
  // real catalog ids, not the synthetic "gemini-3.5-transcribe*" mode ids.
  // Once a real catalog id has been resolved for a call, it must reach the
  // wire unchanged -- resolveBackendModel only rewrites empty/synthetic ids.
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
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([candidateChunk([{ text: body.model }], "STOP")]));
      });
    },
    async (base) => {
      const result = await transcribeAudioViaGateway({
        accessToken: "tok",
        audioBase64: "abc",
        mimeType: "audio/wav",
        model: "gemini-3.8-flash-tiered",
        fetchImpl: fetch,
        gatewayBase: base,
      });
      // The echoed text is the model the server actually received.
      assert.equal(result.text, "gemini-3.8-flash-tiered");
      assert.equal(result.model, "gemini-3.8-flash-tiered");
    }
  );
});

test("isModelRetirementNotice is anchored to short whole-text notices only", () => {
  assert.equal(
    isModelRetirementNotice(
      "Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash in the latest version of Antigravity."
    ),
    true
  );
  assert.equal(isModelRetirementNotice("hello world"), false);
  // A long dictated passage that happens to quote/discuss a retirement
  // notice must NOT be misclassified as the notice itself.
  const longQuote =
    "The error banner said the model is no longer available, please switch to a newer one, and then I kept talking for a while about something completely unrelated to that message, adding enough extra words that this whole transcript comfortably clears the three hundred character anchor the detector uses to stay narrow.";
  assert.ok(longQuote.length >= 300);
  assert.equal(isModelRetirementNotice(longQuote), false);
});

test("classifyRateLimitScope treats quota-exhaustion wording as account-scoped", () => {
  assert.equal(classifyRateLimitScope("Daily quota exceeded for this project"), "account");
  assert.equal(
    classifyRateLimitScope("Resource has been exhausted (e.g. check quota)."),
    "account"
  );
  assert.equal(classifyRateLimitScope("Too many requests, please retry"), "model");
});

test("extractRetryAfterMs parses RetryInfo retryDelay string and object forms", () => {
  assert.equal(extractRetryAfterMs({ error: { details: [{ retryDelay: "12s" }] } }, null), 12_000);
  assert.equal(
    extractRetryAfterMs(
      { error: { details: [{ retryDelay: { seconds: 3, nanos: 500_000_000 } }] } },
      null
    ),
    3_500
  );
  assert.equal(
    extractRetryAfterMs({}, { get: (name) => (name === "retry-after" ? "5" : null) }),
    5_000
  );
  assert.equal(extractRetryAfterMs({}, null), undefined);
});

// --- local HTTP server harness ---------------------------------------------

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function sseBody(lines) {
  return lines.map((line) => `data: ${JSON.stringify(line)}\n\n`).join("");
}

async function withServer(handler, run) {
  const { server, url } = await startServer(handler);
  try {
    await run(url);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function candidateChunk(parts, finishReason) {
  const candidate = { content: { parts } };
  if (finishReason) candidate.finishReason = finishReason;
  return { response: { candidates: [candidate] } };
}

test("streamGenerateContent (via transcribeAudioViaGateway) parses SSE chunks split mid-line and skips thought parts", async () => {
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
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const full =
          sseBody([candidateChunk([{ thought: true, text: "hmm let me think" }])]) +
          sseBody([candidateChunk([{ text: "Hello" }])]) +
          sseBody([candidateChunk([{ text: " world" }], "STOP")]);
        // Split the payload at an arbitrary byte offset, deliberately not on
        // a line boundary, to exercise the partial-line buffering path.
        const mid = Math.floor(full.length / 2);
        res.write(full.slice(0, mid));
        setTimeout(() => {
          res.end(full.slice(mid));
        }, 5);
      });
    },
    async (base) => {
      const result = await transcribeAudioViaGateway({
        accessToken: "tok",
        audioBase64: "abc",
        mimeType: "audio/wav",
        fetchImpl: fetch,
        gatewayBase: base,
      });
      assert.equal(result.text, "Hello world");
      assert.equal(result.finishReason, "STOP");
    }
  );
});

test("streamGenerateContent tolerates a malformed SSE line without crashing", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          "data: {not valid json\n\n" + sseBody([candidateChunk([{ text: "still works" }], "STOP")])
        );
      });
    },
    async (base) => {
      const result = await transcribeAudioViaGateway({
        accessToken: "tok",
        audioBase64: "abc",
        mimeType: "audio/wav",
        fetchImpl: fetch,
        gatewayBase: base,
      });
      assert.equal(result.text, "still works");
    }
  );
});

test("streamGenerateContent detects an anchored retirement notice", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          sseBody([
            candidateChunk(
              [
                {
                  text: "Gemini 3.5 Flash is no longer available. Please switch to Gemini 3.7 Flash.",
                },
              ],
              "STOP"
            ),
          ])
        );
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_MODEL_UNAVAILABLE");
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent maps finishReason MAX_TOKENS to AGY_TRUNCATED", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([candidateChunk([{ text: "partial" }], "MAX_TOKENS")]));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_TRUNCATED");
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent with premature EOF and no finishReason throws AGY_TRUNCATED", async () => {
  // Regression: a stream that ends after real, well-formed content but never
  // emits a terminal finishReason (dropped connection, premature EOF) used
  // to return success with finishReason: null instead of surfacing failure.
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        // No finishReason on this (or any) chunk — the connection just ends.
        res.end(sseBody([candidateChunk([{ text: "some words but then it just stops" }])]));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_TRUNCATED");
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent surfaces an error-shaped SSE data event as a typed error", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        // Google can emit an in-band error event instead of (or after) a
        // non-2xx HTTP status.
        res.end(
          sseBody([{ error: { code: 429, message: "Resource has been exhausted (daily quota)." } }])
        );
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_RATE_LIMITED");
          assert.equal(error.status, 429);
          assert.equal(error.scope, "account");
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent surfaces a non-429 error-shaped SSE data event as AGY_HTTP", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([{ error: { code: 500, message: "internal error mid-stream" } }]));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_HTTP");
          assert.equal(error.status, 500);
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent with a stream of only malformed lines throws AGY_EMPTY_OUTPUT, not AGY_TRUNCATED", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        // Zero valid chunks were ever parsed — distinct from a real
        // truncation where some content was actually received.
        res.end("data: {not valid json at all\n\ndata: {also broken\n\n");
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_EMPTY_OUTPUT");
          return true;
        }
      );
    }
  );
});

test("streamGenerateContent with an empty stream throws AGY_EMPTY_OUTPUT", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseBody([candidateChunk([], "STOP")]));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_EMPTY_OUTPUT");
          return true;
        }
      );
    }
  );
});

test("a stalled server resolves as AGY_TIMEOUT within the operation budget instead of hanging", async () => {
  const { createAntigravityOperation } = require("../../src/helpers/antigravityOperation");
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(": keep-alive\n\n");
        // Deliberately never ends the response.
      });
    },
    async (base) => {
      const op = createAntigravityOperation({ budgetMs: 150, label: "test-stall" });
      const startedAt = Date.now();
      await assert.rejects(
        () =>
          transcribeAudioViaGateway({
            accessToken: "tok",
            audioBase64: "abc",
            mimeType: "audio/wav",
            fetchImpl: fetch,
            gatewayBase: base,
            op,
          }),
        (error) => {
          assert.equal(error.code, "AGY_TIMEOUT");
          return true;
        }
      );
      assert.ok(Date.now() - startedAt < 5_000, "must not hang for the full test timeout");
    }
  );
});

test("generateContent surfaces a 429 as AGY_RATE_LIMITED with status, retryAfterMs, and scope", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: 429,
              message: "Daily quota exceeded for this project.",
              status: "RESOURCE_EXHAUSTED",
              details: [{ retryDelay: "30s" }],
            },
          })
        );
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          generateContent({
            accessToken: "tok",
            projectId: "proj-1",
            model: "gemini-3-flash",
            request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
            fetchImpl: fetch,
            base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_RATE_LIMITED");
          assert.equal(error.status, 429);
          assert.equal(error.retryAfterMs, 30_000);
          assert.equal(error.scope, "account");
          return true;
        }
      );
    }
  );
});

test("generateContent surfaces a 404 as AGY_MODEL_UNAVAILABLE with the real status", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Requested entity was not found." } }));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          generateContent({
            accessToken: "tok",
            projectId: "proj-1",
            model: "gemini-3-flash",
            request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
            fetchImpl: fetch,
            base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_MODEL_UNAVAILABLE");
          assert.equal(error.status, 404);
          return true;
        }
      );
    }
  );
});

test("generateContent surfaces a 500 as AGY_HTTP carrying the real status", async () => {
  await withServer(
    (req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "internal error" } }));
      });
    },
    async (base) => {
      await assert.rejects(
        () =>
          generateContent({
            accessToken: "tok",
            projectId: "proj-1",
            model: "gemini-3-flash",
            request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
            fetchImpl: fetch,
            base,
          }),
        (error) => {
          assert.equal(error.code, "AGY_HTTP");
          assert.equal(error.status, 500);
          return true;
        }
      );
    }
  );
});

test("generateTextViaGateway only ever calls the daily base, never prod", async (t) => {
  // Isolated userData dir: an accountKey-less lookup shares the "default"
  // cache key with other tests in this file, and only wiping the in-memory
  // cache would still hit the persisted-file tier from an earlier test.
  const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-gateway-text-"));
  _setUserDataDirForTests(isolatedDir);
  _resetProjectIdCacheForTests();
  t.after(() => {
    _setUserDataDirForTests(sandboxUserDataDir);
    _resetProjectIdCacheForTests();
    fs.rmSync(isolatedDir, { recursive: true, force: true });
  });
  const calls = [];
  await withServer(
    (req, res) => {
      calls.push(req.url);
      req.on("data", () => {});
      req.on("end", () => {
        if (req.url.includes("loadCodeAssist")) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ cloudaicompanionProject: "proj-1" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            response: {
              candidates: [{ content: { parts: [{ text: "done" }] }, finishReason: "STOP" }],
            },
          })
        );
      });
    },
    async (base) => {
      const text = await generateTextViaGateway({
        accessToken: "tok",
        model: "gemini-3-flash",
        systemPrompt: "",
        userText: "hi",
        fetchImpl: fetch,
        gatewayBase: base,
      });
      assert.equal(text, "done");
      // loadCodeAssist + generateContent, both on the one (daily stand-in) base.
      assert.deepEqual(
        calls.map((url) => url.split(":").pop()),
        ["loadCodeAssist", "generateContent"]
      );
    }
  );
});

// --- project id resolution order -------------------------------------------

test("getAntigravityProjectId resolution order: memory, then persisted, then agy hint (validated), then loadCodeAssist", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-projectid-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  _setUserDataDirForTests(tmpDir);
  _resetProjectIdCacheForTests();
  t.after(() => {
    _setUserDataDirForTests(sandboxUserDataDir);
    _resetProjectIdCacheForTests();
  });

  // Tier 4: no persisted cache, no hint file reachable in this sandboxed
  // home dir -> falls through to a fresh loadCodeAssist discovery call.
  let calls = 0;
  const discovered = await getAntigravityProjectId({
    accessToken: "tok",
    accountKey: "acct-1",
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(String(url), /loadCodeAssist/);
      return { ok: true, json: async () => ({ cloudaicompanionProject: "discovered-proj" }) };
    },
  });
  assert.equal(discovered, "discovered-proj");
  assert.equal(calls, 1);

  // Tier 1: memory cache now short-circuits with zero fetch calls.
  const cached = await getAntigravityProjectId({
    accessToken: "tok",
    accountKey: "acct-1",
    fetchImpl: async () => {
      throw new Error("must not fetch: memory cache should have answered");
    },
  });
  assert.equal(cached, "discovered-proj");

  // Tier 2: persisted file resolves a different account without any network
  // call, proving the persisted cache is consulted before ever fetching.
  _resetProjectIdCacheForTests();
  const persistedPath = path.join(tmpDir, "antigravity-project-id-cache.json");
  fs.writeFileSync(
    persistedPath,
    JSON.stringify({ "acct-2": { projectId: "persisted-proj", updatedAt: Date.now() } })
  );
  const persisted = await getAntigravityProjectId({
    accessToken: "tok",
    accountKey: "acct-2",
    fetchImpl: async () => {
      throw new Error("must not fetch: persisted cache should have answered");
    },
  });
  assert.equal(persisted, "persisted-proj");
});

test("getAntigravityProjectId validates the agy CLI hint with one real call before trusting it", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-projectid-hint-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  _setUserDataDirForTests(tmpDir);
  _resetProjectIdCacheForTests();
  t.after(() => {
    _setUserDataDirForTests(sandboxUserDataDir);
    _resetProjectIdCacheForTests();
  });

  const homedir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-home-hint-"));
  t.after(() => fs.rmSync(homedir, { recursive: true, force: true }));
  const hintDir = path.join(homedir, ".gemini", "antigravity-cli", "cache");
  fs.mkdirSync(hintDir, { recursive: true });
  fs.writeFileSync(path.join(hintDir, "default_project_id.txt"), "hinted-proj\n");

  const originalHomedir = os.homedir;
  os.homedir = () => homedir;
  t.after(() => {
    os.homedir = originalHomedir;
  });

  let sawHintInRequestBody = false;
  const projectId = await getAntigravityProjectId({
    accessToken: "tok",
    accountKey: "acct-hint",
    fetchImpl: async (url, init) => {
      assert.match(String(url), /loadCodeAssist/);
      const body = JSON.parse(init.body);
      if (body.cloudaicompanionProject === "hinted-proj") {
        sawHintInRequestBody = true;
      }
      return { ok: true, json: async () => ({ cloudaicompanionProject: "hinted-proj" }) };
    },
  });

  assert.equal(
    sawHintInRequestBody,
    true,
    "the hint must be sent for validation, not trusted blind"
  );
  assert.equal(projectId, "hinted-proj");
});

test("generateContent respects an explicitly passed daily base and never falls back to prod", async () => {
  let requestedHost = null;
  await withServer(
    (req, res) => {
      requestedHost = req.headers.host;
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            response: {
              candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
            },
          })
        );
      });
    },
    async (base) => {
      const result = await generateContent({
        accessToken: "tok",
        projectId: "proj-1",
        model: "gemini-3-flash",
        request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
        fetchImpl: fetch,
        base,
      });
      assert.equal(result.text, "ok");
      assert.ok(requestedHost);
    }
  );
});
