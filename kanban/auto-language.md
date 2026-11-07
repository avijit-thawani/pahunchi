---
feature: Auto language (no picker) and more Indian languages
tags: [idea]
tests: [lang-probe, manual: one call, she switches Hinglish -> English -> Hindi; he follows, no flip on "ok" or "हम्म"]
transcripts:
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 user asked "why not auto by default?"; deferred, picker moved under options
---

# Auto language

She never picks a language. He answers in whatever she speaks, Hindi, English, Hinglish, later Tamil, Bengali and others, and stays in it the way a real relative would.

## How it works today

The Home picker (Hinglish, Hindi, English) sets one `language` per call, and it goes to three places:

| Step | Hinglish | Hindi | English |
|---|---|---|---|
| Her speech -> text, Sarvam `saaras:v4` `language_code` | `hi-IN` | `hi-IN` | `en-IN` |
| His reply, `google/gemini-3.5-flash-lite`, rules in `server/prompt.ts` | Devanagari + English words in Latin | Devanagari | Indian English |
| His voice, Bulbul v4 Flash `target_language_code` | `hi-IN` | `hi-IN` | `en-IN` |

Hinglish and Hindi differ only in the prompt. Forced `hi-IN` writes her English in Devanagari ("[removed]"), which is why he answered in Hinglish on the real English-mode call of 2026-11-05.

## Offline test, 2026-11-07 (`node scripts/lang-probe.ts`)

- **Ears, 57 real lines from 13 calls:** `language_code=unknown` is as fast as `hi-IN` (sequential medians 660 vs 734 ms) but unusable as the transcript: it labelled 38 lines English, about a dozen of them Hindi at p >= 0.9, and translated them ("हाँ, चलो" -> "Ah, shut up", "[removed]" -> "[removed]"). Two clear Hindi lines came back in Punjabi script (p 0.94, 0.41). On true English lines it is right and writes them in Latin.
- **Brain, "mirror her" prompt, 27 replies:** follows Hindi, Hinglish, Tamil, Bengali, Telugu and stays put after "ok" (21/27); never switches to English (0/6). A "[she is speaking English]" tag gave romanized Hinglish. Today's English prompt got 5/6 Latin-script replies, some still Hinglish ("Achha, number plate bheji kya?").
- **Voice, 13 clips:** the current Hindi voices (dad `sumit`, mom `shreya`) speak Tamil, Bengali and Telugu when given that `target_language_code`; re-transcribed, every clip came back word-for-word in the right language at p 1.00. Accent not judged yet: listen to `logs/lang-probe/voice_*.wav`.

## Revised design

1. Run STT twice in parallel, `hi-IN` and `unknown` (double STT cost, no added latency). `unknown` only decides the language; the transcript the LLM sees is `hi-IN`'s while the call is Hindi/Hinglish, `unknown`'s once it has switched.
2. The call language switches only after two confident lines in a row (p >= 0.8, 3+ words), starting from her last call's language. On the 13 calls that would have left one false switch: her three "White Dzire" plate lines.
3. The call language picks the prompt, as today; Hindi vs Hinglish is left to the model, which already mirrors it. English mode needs a stronger prompt.
4. Voice language from the reply's script (Devanagari -> `hi-IN`, Tamil -> `ta-IN`, Latin -> `en-IN`), so a stray reply is still pronounced right. Script can't tell Hindi from Marathi; use the call language there.
5. Home: no picker; Advanced keeps a manual override. Steps 1-4 run on the server, so web and Android match.

## More languages

Sarvam STT covers 22 Indian languages + English, Bulbul TTS 11. The voices are multilingual, so each role keeps its two voices; native ones (3-9 per language, Tamil only male, none for Malayalam/Odia) only if the accent sounds off. Each language needs prompt rules, fillers and smoke-call lines.

## Notes

- 2026-11-07 offline probe run (above); nothing built in the app.
- 2026-11-07 card created from the user's question.
