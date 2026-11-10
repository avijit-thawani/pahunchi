# Language: how it works, where hints are needed, what we want

A refresher. Card: [kanban/auto-language.md](../kanban/auto-language.md). Numbers from 2026-11-07/10 tests on her real call lines (`scripts/stt-bench.ts`, `stt-eval.ts`, `lang-probe.ts`).

## What the user wants

1. No language picker.
2. He speaks first, before she has said anything: a generic opener ("हाँ बेटा, बोलो" / "Hi beta, where are you?").
3. After her first line he settles on her language and stays in it. Later calls start in the language she used most.
4. As many Indian languages as possible, with the same voice per role across languages (no hand-picking voices per language). Tamil and Telugu first.

## The pipeline, one turn, and where a language hint goes

| Step | Provider (today) | Language hint | Needed? |
|---|---|---|---|
| Her speech -> text | Sarvam `saaras:v4` | `language_code=hi-IN` (`en-IN` in English mode) | Optional: `unknown` auto-detects, but on short Hindi lines it often says "English" and translates ("हाँ, चलो" -> "Ah, shut up") |
| His reply | Gemini 3.5 Flash Lite | language rules in the prompt (`server/prompt.ts`) | Partly: told nothing extra, it mirrors Hindi, Hinglish, Tamil, Bengali, Telugu (21/27), but never switches to English (0/6) |
| His voice | Sarvam Bulbul v4 Flash | `target_language_code=hi-IN` / `en-IN` | Yes, per request. But it can be read off each clause's script (Devanagari -> `hi-IN`, Tamil -> `ta-IN`, Latin -> `en-IN`), so no picker needed |
| Fillers ("हम्म") | cached TTS clips | per language list in `src/lib/call.ts` | Yes, small table per language |

Hindi vs Hinglish differs only in the prompt; the speech-to-text and the voice get `hi-IN` for both.

### Hints per speech-to-text provider

| Provider | Hint | Auto-detect | Notes from our test |
|---|---|---|---|
| Sarvam saaras:v4 | `language_code` (22 Indian + English) | `unknown` (+ returns detected code and probability) | forced `hi-IN`: English comes out in Devanagari |
| ElevenLabs Scribe v2 | `language_code`, optional | yes if omitted | best on English, weaker on Hinglish |
| Smallest Pulse | `language` (`hi` = Hindi+English mixed script, `ta`, `te`, ...) | `north_indic` (en/hi/gu/mr/bn/or), `multi-south-indic` (ta/te/kn/ml) on streaming | Tamil/Telugu streaming India region only |
| OpenAI gpt-4o-mini-transcribe | `language`, ignored | n/a | writes Urdu, Punjabi, Chinese scripts: out |

## Same voice across languages

Bulbul voices aren't tied to a language; the `_hi_` in `sumit_hi_conversational` is the voice's home style. Dad `sumit` and mom `shreya` spoke Tamil, Bengali and Telugu; re-transcribed, every clip came back word for word. Accent not judged yet (`logs/lang-probe/voice_*.wav`). Native voices exist for 7 languages but are few (Tamil: only male).

## The user's proposal (2026-11-10), and how it maps

1. **Opener in a generic line.** Works: the voice hint comes from the opener's own script. Hinglish opener on a first-ever call; the last call's language after that.
2. **Her first line: transcribe twice, decide once.** Run two speech-to-text configs in parallel (e.g. Sarvam `hi-IN` + Sarvam `unknown`, or Smallest `north_indic` + `multi-south-indic`): costs a second transcription, adds no wait. Then decide her language:
   - in the reply call itself: give the LLM both transcripts and ask it to start with a tag like `<lang=ta>` before its words; we strip the tag and lock the hints. No extra round trip.
   - or a separate small LLM call first: cleaner, but adds ~0.5-0.8 s to that one reply.
3. **Lock** speech-to-text hint, prompt rules and fillers for the rest of the call; switch only on strong repeated evidence (two confident lines in a row).
4. **Voice stays the same**; its language code follows each clause's script.

**Tested 2026-11-10** (`scripts/lang-first-turn.ts`; 48 real lines + 20 synthetic lines in ta/te/bn/mr/kn voiced by the sister's Sarvam voice; 2 samples each; Gemini 3.5 Flash Lite):

| Approach | Hindi/Hinglish | English | ta / te / bn / mr / kn | Added wait |
|---|---|---|---|---|
| Tag in the reply, today's prompt | 76/76 | 1/20 | 0 / 0 / 0 / 3 / 0 of 8 | none (tag at ~0.69 s) |
| Tag in the reply, language-neutral prompt | 76/76 | 2/20 | 2 / 2 / 0 / 4 / 1 | none |
| Separate small classifier call | 65/76 | 16/20 | 2 / 6 / 3 / 6 / 5 | ~0.65 s if it blocks |
| Sarvam auto-detect alone | 34/76 | 20/20 | 2 / 8 / 6 / 6 / 6 | none |

- The reply model won't leave Hindi: the persona prompt pulls it there even with a confident Telugu guess. So the tag-in-reply idea fails as is.
- The classifier works best but shouldn't block. Run it alongside each reply and switch language from the next reply once two lines in a row agree. Simulated on whole calls: no Hindi call ever switched wrongly; both English calls locked after line 2; Telugu, Kannada, Marathi after 2-3 lines; Tamil and Bengali never (their short lines came back as "English" or as Hindi translations).
- Sarvam's Hindi setting translates other languages into Hindi (Kannada "ಇನ್ನೂ ಇಪ್ಪತ್ತು ನಿಮಿಷ ಆಗುತ್ತೆ" -> "अभी 20 मिनट लगेगा"), so for non-Hindi speakers the auto-detect version is the only usable one.
- Next: add a third view for South and East Indian languages (Smallest `multi-south-indic` streaming, which auto-detects ta/te/kn/ml) and test with real speakers.

## Speech-to-text, current best (49 lines, 4 rounds; text ready after she stops, p50/p90; accuracy 0-2 by Gemini 4 Argon + GPT-6.1 Sol)

| Engine | p50 / p90 | Accuracy | $/hour |
|---|---|---|---|
| Sarvam streaming | 316 / 358 ms | 1.03 | 0.35 |
| Scribe v2 | 378 / 517 ms | 1.03 | 0.22 |
| Scribe v2 Realtime | 94 / 149 ms | 0.92 | 0.39 |
| Sarvam `hi-IN` (today) | 608 / 1007 ms | 1.08 | 0.35 |
| Smallest Pulse | 522 / 904 ms | 1.11 | 0.18 |
| Smallest Pulse streaming | 143 / 201 ms | 0.84 | 0.24 |

Differences under ~0.25 in accuracy are noise. By language (Hindi 12 / Hinglish 26 / English 10 lines; `logs/stt-bench/report2.md`): Scribe is best on English (1.60) but weak on Hinglish (0.81); Sarvam is even across all three (0.92-1.30); Smallest batch is best on Hindi (1.21); all streaming modes drop on Hinglish (0.65-1.02). Per-language groups are small: CIs span ~±0.5.
