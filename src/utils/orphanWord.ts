// Typographic widow/orphan control: keeps a short trailing word from being
// stranded alone on the last line of a narrow container, without silently
// making an entire sentence unbreakable.
//
// One fix that always applies, and one binding decision gated by two
// independent triggers, both applied relative to the LAST word of the
// string:
//
// 1. Non-breaking hyphen (always). A plain ASCII hyphen is a legal line-break
//    opportunity in browsers (UAX #14), so a hyphenated last word (German's
//    "MoreOpenWhisperer-Fork.") can split in two even once the space before
//    it is protected. Swapping it for U+2011 (non-breaking hyphen) removes
//    that break point. Safe unconditionally: it never changes anything for a
//    non-hyphenated word.
//
// 2. Non-breaking space before the last word (conditional). Binding the last
//    two words together prevents two distinct kinds of stranded-word defect:
//      (a) the last word itself is short ("fork.", 5 chars, left alone after
//          "Unofficial MoreOpenWhisperer"), or
//      (b) the word immediately before it is a short function word (an
//          article/preposition like fr/es "de", pt "do", it "di" — 2 chars —
//          left dangling alone at the end of a line, e.g. "Fork non officiel
//          de" / "MoreOpenWhisperer.").
//    But binding must NOT apply when the string has only one inter-word
//    space to begin with: binding that single space turns the WHOLE string
//    into one unbreakable run. This is exactly German's "Inoffizieller
//    MoreOpenWhisperer-Fork." (one space total) — binding it forced the
//    two-word remainder past the sidebar's content width. Once the hyphen
//    fix (1) already keeps "MoreOpenWhisperer-Fork." together as its own
//    wrappable unit, there is nothing left to fix for German, so the space
//    is left alone regardless of word lengths. This single-gap veto applies
//    to BOTH (a) and (b).
const NBSP = "\u00A0";
const NON_BREAKING_HYPHEN = "\u2011";

// A last word at or under this length reads as a short trailing fragment
// that looks stranded alone on a line — the production examples are "fork."
// (5), "分支。" (3), "Google." (7). A last word above it (e.g. the 18/19-char
// "MoreOpenWhisperer.") is a normal long word that wraps onto its own line
// with no orphan impression, so binding it buys nothing while adding overflow
// risk. Measured against the real disclosure strings across all 10 locales:
// every orphan-risk tail is <=7 chars and every safe-to-leave-alone tail is
// >=18 chars, so 8 sits cleanly in the gap.
const SHORT_WORD_MAX_LENGTH = 8;

// The word immediately before the last word, if <= this length, is treated
// as a short function word that must not be left dangling alone at the end
// of a line. Measured against the real strings: fr/es "de", pt "do", it "di"
// are all exactly 2 chars, while the only other short-ish lead-in in the
// same position (Russian "форк", "fork", 4 chars) is a real noun, not a
// stranded article/preposition, and reads fine left alone. 3 sits right
// between those two groups: it catches the 2-char articles with a one-char
// margin, without reaching the 4-char noun.
const LEAD_IN_WORD_MAX_LENGTH = 3;

// Captures: (everything up to and including the last non-space char before
// the final gap)(the final whitespace gap)(the last word)(any trailing
// whitespace). The greedy `[\s\S]*\S` head naturally backtracks to the last
// possible split point, so this finds the *last* inter-word space, not the
// first.
const LAST_WORD_PATTERN = /^([\s\S]*\S)(\s+)(\S+)(\s*)$/;

// The word immediately preceding `head`'s own end, i.e. the word right
// before the last inter-word gap. `head` never has trailing whitespace (the
// pattern above requires it to end in \S), so this simply captures head's
// own trailing run of non-space characters.
const LEAD_IN_WORD_PATTERN = /(\S+)$/;

/**
 * Returns `text` with:
 *  - any hyphen in the last word replaced by a non-breaking hyphen (always), and
 *  - the last inter-word space replaced by a non-breaking space, when EITHER
 *      - the last word is short (<= SHORT_WORD_MAX_LENGTH), OR
 *      - the word before it is a short function word (<= LEAD_IN_WORD_MAX_LENGTH),
 *    AND the string has more than one inter-word space (so binding can never
 *    make the whole string unbreakable).
 *
 * - A single-word string (no space) is returned unchanged.
 * - An empty or whitespace-only string is returned unchanged (never throws).
 * - Trailing whitespace/punctuation is preserved exactly.
 * - Does not mutate the input; safe to call on already-translated strings at
 *   render time.
 */
export function preventOrphanWord(text: string): string {
  const match = LAST_WORD_PATTERN.exec(text);
  if (!match) return text;

  const [, head, gap, lastWord, trailingSpace] = match;
  const boundLastWord = lastWord.replace(/-/g, NON_BREAKING_HYPHEN);

  // `head` containing no whitespace means the matched gap was the ONLY space
  // in the whole string — binding it would make the entire string one
  // unbreakable run.
  const isOnlyGapInString = !/\s/.test(head);
  const isShortTrailingWord = lastWord.length <= SHORT_WORD_MAX_LENGTH;

  const leadInMatch = LEAD_IN_WORD_PATTERN.exec(head);
  const leadInWord = leadInMatch ? leadInMatch[1] : "";
  const hasDanglingLeadInWord =
    leadInWord.length > 0 && leadInWord.length <= LEAD_IN_WORD_MAX_LENGTH;

  const shouldBindSpace = (isShortTrailingWord || hasDanglingLeadInWord) && !isOnlyGapInString;

  const boundGap = shouldBindSpace ? NBSP : gap;
  return `${head}${boundGap}${boundLastWord}${trailingSpace}`;
}
