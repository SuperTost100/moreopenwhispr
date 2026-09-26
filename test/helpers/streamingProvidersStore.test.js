const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");

async function loadStore() {
  const { build } = await import("vite");
  const buildResult = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      ssr: path.join(__dirname, "../../src/stores/streamingProvidersStore.ts"),
      write: false,
      rolldownOptions: { output: { format: "cjs" } },
    },
  });
  const chunk = buildResult.output.find((entry) => entry.type === "chunk");
  assert.ok(chunk, "the store must compile to an SSR chunk");
  const compiledModule = new Module(chunk.fileName);
  compiledModule.filename = path.join(__dirname, chunk.fileName);
  compiledModule.paths = Module._nodeModulePaths(path.join(__dirname, "../.."));
  compiledModule._compile(chunk.code, compiledModule.filename);
  return compiledModule.exports;
}

test("MoreOpenWhisperer never asks OpenWhispr Cloud for managed providers", async (t) => {
  const previousWindow = globalThis.window;
  let calls = 0;
  globalThis.window = {
    electronAPI: {
      getNoteRecordingConfig: async () => {
        calls += 1;
        return { success: false, error: "disabled" };
      },
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });

  const { fetchProviders, useStreamingProvidersStore } = await loadStore();
  const result = await fetchProviders();

  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.deepEqual(useStreamingProvidersStore.getState().providers, []);
});

test(
  "note recording config failures retain their structured policy metadata",
  {
    skip: "MoreOpenWhisperer build: managed providers come from OpenWhispr Cloud, which is never contacted",
  },
  async (t) => {
    t.mock.method(console, "warn", () => {});
    const previousWindow = globalThis.window;
    const failure = {
      success: false,
      error: "Blocked by workspace policy",
      code: "POLICY_RESTRICTED",
      status: 403,
    };
    globalThis.window = {
      electronAPI: {
        getNoteRecordingConfig: async () => failure,
      },
    };
    t.after(() => {
      globalThis.window = previousWindow;
    });

    const { build } = await import("vite");
    const buildResult = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        ssr: path.join(__dirname, "../../src/stores/streamingProvidersStore.ts"),
        write: false,
        rolldownOptions: { output: { format: "cjs" } },
      },
    });
    const chunk = buildResult.output.find((entry) => entry.type === "chunk");
    assert.ok(chunk, "the store must compile to an SSR chunk");
    const compiledModule = new Module(chunk.fileName);
    compiledModule.filename = path.join(__dirname, chunk.fileName);
    compiledModule.paths = Module._nodeModulePaths(path.join(__dirname, "../.."));
    compiledModule._compile(chunk.code, compiledModule.filename);
    const { fetchProviders, useStreamingProvidersStore } = compiledModule.exports;
    const existingProviders = [{ id: "openai", name: "OpenAI", models: [] }];
    useStreamingProvidersStore.setState({ providers: existingProviders });

    const result = await fetchProviders();

    assert.deepEqual(result, failure);
    assert.deepEqual(useStreamingProvidersStore.getState().providers, existingProviders);
  }
);
