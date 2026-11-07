---
feature: Auto language (no picker) and more Indian languages
tags: [idea]
tests: [lang-probe, manual: one call, she switches Hinglish -> English -> Hindi; he follows, no flip on "ok" or "हम्म"]
transcripts:
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 user asked "why not auto by default?"; deferred, picker moved under options
---

# Auto language

## Goal (the user's, 2026-11-07)

1. **No language picker.** He speaks her language without her choosing it.
2. **First call:** he speaks first, before she has said anything, so open in English with Hindi warmth ("Hi beta, where are you?" for dad).
3. **Later calls:** use the language she spoke most in past turns, and tell the prompt.
4. **As many languages as possible**, without hand-picking voices per language: the same voices speaking Tamil and Telugu are the first target.

## How it works today

The Home picker (Hinglish, Hindi, English) sets one `language` per call. It sets Sarvam STT's `language_code` (`hi-IN`, or `en-IN` for English), the prompt's language rules, and Bulbul's `target_language_code` (same split). Hinglish and Hindi differ only in the prompt.

## What we know (`node scripts/lang-probe.ts`, 2026-11-07)

- **Her language, before the AI sees her words:** no reliable signal yet. Sarvam's `language_code=unknown` is as fast as `hi-IN` (660 vs 734 ms) but on 57 real lines it called a dozen Hindi lines English at p >= 0.9 and translated them ("हाँ, चलो" -> "Ah, shut up"), and two Hindi lines Punjabi. Usable only as a vote over several long lines.
- **His language, before TTS:** solved without hoping. Each clause's text is known before it goes to TTS; its script gives the language (Devanagari -> `hi-IN`, Tamil -> `ta-IN`, Latin -> `en-IN`).
- **The AI following her:** a "mirror her" prompt followed Hindi, Hinglish, Tamil, Bengali, Telugu (21/27) but never English (0/6). Even in today's English mode he drifted into Hinglish on the real 2026-11-05 call, although STT gave her English in Latin script there. So the prompt, not STT, pulls him to Hindi.
- **Same voices, other languages:** dad `sumit` and mom `shreya` spoke Tamil, Bengali, Telugu; all six clips re-transcribed word for word. Accent unjudged: `logs/lang-probe/voice_*.wav`.

## Untested (needed before building)

- **STT accuracy on her real voice.** `docs/latency.md` timed STT on lab TTS clips only. Next: the 57 real lines through Sarvam (`hi-IN`, `codemix`), Scribe v2, `gpt-4o-mini-transcribe` and a streaming STT, scored against hand-checked transcripts.
- **LLM choice.** Only Gemini 3.5 Flash Lite has run. Candidates from `../sense` (fastest there): Gemma 4 31B (0.64 s), Gemini 3.1 Flash Lite (no thinking), Gemma 4 26B A4B; plus Sarvam-105B (tuned for Indian languages). Score first-phrase time, language following, and staying in character.

## Design sketch

Open in English + Hindi on a first call; after that, start in her most-used language from past calls. Switch mid-call only on two confident lines in a row. Voice language from each clause's script. Home loses the picker; Advanced keeps an override. All server-side, so web and Android match.

## Notes

- 2026-11-07 goals recorded; corrected an earlier wrong claim that STT caused the Hinglish replies on the English-mode call.
- 2026-11-07 offline probe run; nothing built in the app.
