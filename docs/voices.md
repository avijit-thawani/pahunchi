<!-- Cap: 120 lines. Replace stale findings rather than appending. -->

# Voices: what was tried (Nov 2026)

All through OpenRouter `POST /api/v1/audio/speech`. Judge: `google/gemini-3.8-flash` with the
audio attached, scoring Indian accent, Hindi pronunciation, naturalness and role fit (1-10).
Treat judge scores as a shortlist only; it is generous and inconsistent across runs. Ears decide.

## Audition (one Hinglish line per voice)

Her line: "White Dzire hai. DL 3C, AB, 4521." (hard: brand name + plate). Dad: "Hmm, likh liya.
Haan, location share aa gaya hai. Toh kitni der mein pahunch jaogi?"

| Model | Her best (score) | Dad best (score) | Latency* | Cost / 1k chars |
|---|---|---|---|---|
| Gemini 3.8 Flash TTS | Sulafat 9.5, Leda 9.0 | Algenib 9.8, Gacrux/Orus/Sadaltager 9.5 | 3-5 s | $0.023 |
| Gemini 3.8 Flash Lite TTS | Sulafat 5.8 (stiff) | Algenib 9.5 | 2.5 s | ~$0.015 |
| Microsoft MAI-Voice-2.1 | all hi-IN female voices added/repeated words | hi-IN-Grant 9.8, Dhruv 9.5 | 1.3-2 s | $0.022 |
| ElevenLabs v3 | sarah 6.0; lily, jessica ~2 (foreign accent) | brian 9.8, bill 9.5 | 2-2.7 s | $0.080 |
| Grok Voice TTS | eve 7.0 ("Dzire" -> "desire") | leo 8.8, rex 8.5 | ~1 s | $0.015 |
| Fish Drama 3 (no preset voice) | 5.0 | 9.8 | 1.5 s | $0.002 |
| Fish S2.1 Pro (no preset voice) | 1.0 (came out male) | 8.8 | 2-2.5 s | $0.015 |
| Seed Audio 1.0 (voice from prompt) | 4.5 | 7.2 | 12 s | per second |

*Whole-line, non-streaming request time, not time to first audio.

Takeaways:
- **Her voice is the hard part.** Only Gemini, steered with a style line, sounded like a young Delhi
  woman. Microsoft's native Hindi female voices garbled the mixed-script plate line.
- **Dad is easy.** Most providers have a convincing older Indian man. That is the voice the user
  actually hears in the product, so latency and cost matter more there than her voice does.
- Gemini is the slowest (3-5 s per line, non-streaming). For live calls, measure streaming
  time-to-first-audio before committing; Microsoft Grant and Grok leo are 1-1.5 s alternatives.
- Fish and Seed have no preset voices on OpenRouter, so the speaker can drift between lines. Fish
  supports cloning from a reference clip (`input_references`), which could pin a voice cheaply.

## Steering tips (carried over from ../scratch/ai-video/docs/tts.md)

- Gemini: put tone in `instructions` (sent as `speech_metadata.style`), keep it short. Text in
  brackets or parentheses inside `input` may be read aloud.
- Write Hindi in Devanagari; leave English words (cab, location, Maps) in Latin script.
- Spell out plates as spoken: "डी एल थ्री सी, ए बी, फ़ोर फ़ाइव टू वन".

## Full calls (sim/out/mix)

Gemini, Microsoft, ElevenLabs and Grok each voiced all 3 scenes with their best audition voices.
Dad side: 300-3400 Hz band, 8 kHz resample, light compression and line hiss, plus a TV room bed at
-42 dB. Her side: cab or street bed at -34 dB. Ambience came from Seed Audio text prompts ($0.06-0.08
per clip).

Known issues:
- The "cab" bed sounds more like a train carriage; the street bed is 9 s and loops audibly. Regenerate
  with more specific prompts (small hatchback, AC fan, indicator ticks) and longer durations.
- The judge flagged "location share aa gaya hai" as slightly unnatural ("location aa gayi"). That
  wording came from the brief; try both.
- Microsoft read "Dzire" as "jee-re" or "zay-ray"; Grok read it as "desire". Spell it "डिज़ायर" for TTS.

## Next experiments

1. Owner ear check of `sim/out/index.html`; pick her voice and a dad shortlist.
2. Streaming latency: time to first audio byte for Gemini vs Microsoft Grant vs Grok leo.
3. Same dad voice across Hindi and English, plus female responders (mom, friend, sister).
4. A cheaper realtime path: `openai/gpt-audio-mini` (speech in, speech out) vs STT -> LLM -> TTS.
