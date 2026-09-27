# Antigravity model blurbs stay in English

Importance: Low importance

The Antigravity rows in Settings use description keys under `models.descriptions`. In German, Spanish, French, Italian, Japanese, Portuguese, Russian, Simplified Chinese, and Traditional Chinese, these values are the same English sentences as in `src/locales/en/translation.json`:

- `models.descriptions.transcription.antigravity_gemini_3_5_transcribe`
- `models.descriptions.transcription.antigravity_gemini_3_5_transcribe_live`
- `models.descriptions.cloud.antigravity_gemini_3_5_flash_low`
- `models.descriptions.cloud.antigravity_gemini_3_5_flash_medium`
- `models.descriptions.cloud.antigravity_gemini_3_5_flash_high`
- `models.descriptions.cloud.antigravity_gemini_3_7_flash_low`
- `models.descriptions.cloud.antigravity_gemini_3_7_flash_medium`
- `models.descriptions.cloud.antigravity_gemini_3_7_flash_high`
- `models.descriptions.cloud.antigravity_gemini_3_1_pro_high`
- `models.descriptions.cloud.antigravity_claude_sonnet_4_6`
- `models.descriptions.cloud.antigravity_claude_opus_4_6`

Someone who uses the app in one of those languages still reads "Fast cleanup via Antigravity subscription" and the other English blurbs. The keys exist, so the i18n check does not report them. The strings sit on the model picker, not on the main dictation screen.
