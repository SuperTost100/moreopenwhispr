L01 - Antigravity descriptions left in English

Status: FIXED NOW

Reproduced on HEAD after the M09/M03 commit (1a29f5f3): de, es, fr, it, ja,
pt, ru, zh-CN, zh-TW all had the antigravity_gemini_3_7_flash_low/medium,
antigravity_gemini_3_1_pro_high, antigravity_claude_sonnet_4_6, and
antigravity_claude_opus_4_6 description values as the literal English
sentences from en/translation.json (and were missing the new
antigravity_gemini_3_8_flash_* keys M09 added). Arabic had already been
translated correctly for all of these except the stale "latest Flash" claim
on gemini-3.7-flash-high, which needed updating now that 3.8 is the newest
tier.

Fix
- Wrote each locale file with a small node script (read -> modify -> write,
  2-space indent, trailing newline preserved), per the shared-file rule:
  - Removed antigravity_gemini_3_5_flash_low/medium/high (rows M03 deleted
    from the registry) from every locale that still had them.
  - Added antigravity_gemini_3_8_flash_low/medium/high with real
    translations in de, es, fr, it, ja, pt, ru, zh-CN, zh-TW, and ar.
  - Translated antigravity_gemini_3_5_transcribe(_live),
    antigravity_gemini_3_7_flash_low/medium/high,
    antigravity_gemini_3_1_pro_high, antigravity_claude_sonnet_4_6, and
    antigravity_claude_opus_4_6 into de, es, fr, it, ja, pt, ru, zh-CN,
    zh-TW (all previously English text).
  - Updated Arabic's antigravity_gemini_3_7_flash_high from "latest Flash"
    to "previous Flash generation" and added its three 3.8 rows, in the
    existing Arabic style.
  - Brand/model names (Antigravity, Claude, Opus, Flash, Pro, Gemini) were
    left untranslated in every language, matching the rest of the file and
    the project's i18n rule.
- Wrote translations myself (short, natural phrasing per language); did not
  use an external tool for this pass.

Files changed
- src/locales/ar/translation.json
- src/locales/de/translation.json
- src/locales/es/translation.json
- src/locales/fr/translation.json
- src/locales/it/translation.json
- src/locales/ja/translation.json
- src/locales/pt/translation.json
- src/locales/ru/translation.json
- src/locales/zh-CN/translation.json
- src/locales/zh-TW/translation.json
(en/translation.json was already updated in the M09 commit.)

Tests
- test/locales/antigravityDescriptionTranslations.test.js (new):
  - registry's antigravity descriptionKey set has at least the 11 known keys
  - every locale (en included) defines every key the registry currently
    references
  - no non-en locale's value is byte-for-byte equal to the en value for any
    antigravity description key
- Command: `node --test test/locales/antigravityDescriptionTranslations.test.js
  test/locales/translationCoverage.test.js`
- before.txt / after.txt in this folder: before shows the missing-key and
  English-equals-en failures across all 9 untranslated locales; after is a
  clean run of both the new test and the pre-existing translation coverage
  suite (which was already failing after the M09/M03 commit because of the
  new, then-untranslated 3.8 keys, and is fixed by this commit too).
- `npm run typecheck` clean; all 10 touched locale files parse as valid JSON.

Commit: fc6ee2fd "Translate the remaining Antigravity model blurbs"
