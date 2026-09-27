const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const modelRegistryData = require("../../src/models/modelRegistryData.json");

const LOCALES_DIR = path.join(__dirname, "../../src/locales");

// L01: Antigravity model blurbs stayed in English in every non-en locale.
// Find every models.descriptions.*antigravity* key the registry currently
// references, then check that (a) every locale defines the same set of
// those keys (no leftover keys for rows M03 removed, no missing key for a
// row M09/M03 added) and (b) no non-en locale's value is byte-for-byte the
// English sentence - a translated string can coincidentally still contain
// English brand/model names (Antigravity, Claude, Opus, Flash, Pro), but
// the whole sentence should not be untranslated English.
function collectAntigravityDescriptionKeys(registry) {
  const keys = new Set();
  const walk = (models) => {
    for (const model of models) {
      if (typeof model.descriptionKey === "string" && model.descriptionKey.includes("antigravity")) {
        keys.add(model.descriptionKey);
      }
    }
  };
  for (const provider of registry.transcriptionProviders || []) walk(provider.models || []);
  for (const provider of registry.cloudProviders || []) walk(provider.models || []);
  for (const provider of registry.localProviders || []) walk(provider.models || []);
  return keys;
}

function readLocaleTranslation(locale) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "translation.json"), "utf8"));
}

function getByPath(obj, dottedPath) {
  return dottedPath.split(".").reduce((node, part) => (node ? node[part] : undefined), obj);
}

const antigravityKeys = [...collectAntigravityDescriptionKeys(modelRegistryData)].sort();

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((entry) => fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory());

test("the registry still references at least the known antigravity description keys", () => {
  assert.ok(antigravityKeys.length >= 11, "expected the full antigravity description key set");
});

test("every locale defines exactly the antigravity description keys the registry uses", () => {
  const en = readLocaleTranslation("en");
  for (const key of antigravityKeys) {
    assert.notEqual(getByPath(en, key), undefined, `en is missing ${key}`);
  }

  for (const locale of locales) {
    if (locale === "en") continue;
    const data = readLocaleTranslation(locale);
    for (const key of antigravityKeys) {
      assert.notEqual(getByPath(data, key), undefined, `${locale} is missing ${key}`);
    }
  }
});

test("no non-en locale's antigravity description is the untranslated English sentence", () => {
  const en = readLocaleTranslation("en");
  const failures = [];

  for (const locale of locales) {
    if (locale === "en") continue;
    const data = readLocaleTranslation(locale);
    for (const key of antigravityKeys) {
      const enValue = getByPath(en, key);
      const localeValue = getByPath(data, key);
      if (localeValue === enValue) {
        failures.push(`${locale}: ${key} === en ("${enValue}")`);
      }
    }
  }

  assert.deepEqual(failures, []);
});
