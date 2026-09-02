const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/utils/orphanWord.ts");

const NBSP = "\u00A0";
const NON_BREAKING_HYPHEN = "\u2011";

test("binds a short final word to the word before it (multi-gap string)", async () => {
  const { preventOrphanWord } = await load();
  // Real production string: "fork." (5 chars) is a genuine orphan risk.
  assert.equal(
    preventOrphanWord("Unofficial MoreOpenWhisperer fork."),
    `Unofficial MoreOpenWhisperer${NBSP}fork.`
  );
});

test("does not bind when both the final word and its lead-in are long", async () => {
  const { preventOrphanWord } = await load();
  // Real production string: "MoreOpenWhisperer." (18 chars) reads fine on
  // its own line, and its lead-in "MoreOpenWhisperer" (from a 3-word variant)
  // would also be long. Use a case with a long final word AND a long lead-in
  // word so neither trigger fires.
  const input = "Totally unofficial system MoreOpenWhisperer.";
  assert.equal(preventOrphanWord(input), input);
});

test("binds when the final word is long but its lead-in is a short function word", async () => {
  const { preventOrphanWord } = await load();
  // Real production string (fr): "de" (2 chars) is a dangling article that
  // must not be left alone at the end of a line, even though the final word
  // "MoreOpenWhisperer." (18 chars) is not itself short.
  assert.equal(
    preventOrphanWord("Fork non officiel de MoreOpenWhisperer."),
    `Fork non officiel de${NBSP}MoreOpenWhisperer.`
  );
});

test("does not bind a long final word with a long lead-in word (4-char lead-in stays unbound)", async () => {
  const { preventOrphanWord } = await load();
  // Real production string (ru): "форк" ("fork", 4 chars) is a real noun,
  // not a dangling article — it's one character above the lead-in threshold
  // and reads fine left alone, so neither trigger should fire.
  const input = "Неофициальный форк MoreOpenWhisperer.";
  assert.equal(preventOrphanWord(input), input);
});

test("never binds when the string has only one space, even if the tail is long", async () => {
  const { preventOrphanWord } = await load();
  // Real production string (German): the ONLY space in the whole sentence.
  // Binding it would make the entire sentence a single unbreakable run and
  // overflow the container. The hyphen is still neutralized. The single-gap
  // veto applies even though the lead-in word "Inoffizieller" happens to be
  // long (so rule (b) would not have fired anyway) — this test pins the
  // veto itself, independent of which rule would have triggered.
  assert.equal(
    preventOrphanWord("Inoffizieller MoreOpenWhisperer-Fork."),
    `Inoffizieller MoreOpenWhisperer${NON_BREAKING_HYPHEN}Fork.`
  );
});

test("the single-gap veto wins even when the lead-in word is short", async () => {
  const { preventOrphanWord } = await load();
  // Synthetic: lead-in "Hi" (2 chars, would trigger rule (b) on its own),
  // but it is the string's only space — the single-gap guard must still win.
  assert.equal(preventOrphanWord("Hi there"), "Hi there");
});

test("neutralizes a hyphen in the last word even when the space IS bound", async () => {
  const { preventOrphanWord } = await load();
  // Synthetic: multiple gaps (safe to bind) AND a short hyphenated tail.
  assert.equal(preventOrphanWord("A B c-d"), `A B${NBSP}c${NON_BREAKING_HYPHEN}d`);
});

test("leaves a single-word string unchanged", async () => {
  const { preventOrphanWord } = await load();
  assert.equal(preventOrphanWord("Required."), "Required.");
  assert.equal(preventOrphanWord("Word"), "Word");
});

test("does not throw on an empty or whitespace-only string", async () => {
  const { preventOrphanWord } = await load();
  assert.equal(preventOrphanWord(""), "");
  assert.equal(preventOrphanWord("   "), "   ");
});

test("preserves trailing punctuation intact on a bound short word", async () => {
  const { preventOrphanWord } = await load();
  // Real production string: "Google." (7 chars) is short enough to bind,
  // and has 3 spaces so the single-gap guard doesn't apply.
  assert.equal(
    preventOrphanWord("Not affiliated with Google."),
    `Not affiliated with${NBSP}Google.`
  );
});

test("preserves trailing whitespace after a bound last word", async () => {
  const { preventOrphanWord } = await load();
  assert.equal(preventOrphanWord("Hello there world  "), `Hello there${NBSP}world  `);
});
