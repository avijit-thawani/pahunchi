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

Untested: how often the LLM picks the right language from two transcripts of one short line. Next test (automatic, cheap): our 49 lines with their known language, 2 transcripts each -> LLM guess -> accuracy per language.

## Speech-to-text, current best (49 lines, 4 rounds; text ready after she stops, p50/p90; accuracy 0-2 by Gemini 4 Argon + GPT-6.1 Sol)

| Engine | p50 / p90 | Accuracy | $/hour |
|---|---|---|---|
| Sarvam streaming | 316 / 358 ms | 1.03 | 0.35 |
| Scribe v2 | 378 / 517 ms | 1.03 | 0.22 |
| Scribe v2 Realtime | 94 / 149 ms | 0.92 | 0.39 |
| Sarvam `hi-IN` (today) | 608 / 1007 ms | 1.08 | 0.35 |
| Smallest Pulse (batch, streaming) | being measured | | 0.18, 0.24 |

Differences under ~0.25 in accuracy are noise.
