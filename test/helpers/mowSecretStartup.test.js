"use strict";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

describe("MOW secret startup", () => {
  before(() => {
    const electron = {
      app: {
        getPath: () => "/tmp/mow-test",
      },
    };
    process.resourcesPath = "/tmp/mow-resources";
    const originalLoad = Module._load;
    Module._load = function mockLoad(request, parent, isMain) {
      if (request === "electron") return electron;
      if (request === "@napi-rs/keyring") {
        throw new Error("keyring should not load at startup");
      }
      return originalLoad(request, parent, isMain);
    };
  });

  it("tokenStore returns null without reading auth-token.bin", () => {
    const tokenStore = require("../../src/helpers/tokenStore.js");
    assert.equal(tokenStore.get(), null);
  });

  it("environment init skips bulk secret load", async () => {
    const EnvironmentManager = require("../../src/helpers/environment.js");
    const env = new EnvironmentManager();
    await env.init();
    assert.equal(process.env.OPENAI_API_KEY, undefined);
  });
});
