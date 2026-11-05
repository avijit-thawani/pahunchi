<!-- Cap: 120 lines. Replace stale numbers rather than appending. -->

# Latency: her last word -> his first sound (Nov 2026)

Harness: `uv run sim/latency.py tts|stt|llm|audiollm|s2s|live|judge|render|report`. Her turns are the
lab's Sulafat clips (9 turns over 3 scenes); every stage is a real OpenRouter call timed from this Mac
(US East). Raw rows: `sim/out/latency/*.jsonl`; tables: `sim/out/latency/report.md`; listen to calls
with the real measured gaps in `sim/out/latency/mix/<scene>__<pipeline>.mp3`. This study cost ~$0.28.

## End to end (median of 9 turns, seconds)

Measured = STT + LLM time to first clause + TTS time to first audio byte, run turn by turn with each
pipeline's own history. Turn detection is added on top (we can't measure it with clean clips).

| Pipeline | STT | LLM clause | TTS 1st byte | Measured | +500 ms VAD | Voice score* | Stays silent? |
|---|---|---|---|---|---|---|---|
| Gemini TTS Algenib (app today) | 0.93 | 0.73 | 1.84 | 3.61 | **4.1** | 8.5 | yes |
| Microsoft MAI-Voice-2.1 Grant | 0.80 | 0.80 | 0.98 | 3.03 | 3.5 | 8.5 | yes |
| ElevenLabs Flash v2.5 brian | 1.13 | 0.75 | 0.31 | 2.21 | 2.7 | 8.6 | yes |
| **Fish Drama 3, cloned from an Algenib clip** | 0.85 | 0.74 | 0.41 | 2.11 | **2.6** | **9.0** | yes |
| gpt-audio-mini speech-to-speech | - | - | - | 1.42 | **1.9** | 8.5 | **never** |

*Audio-LLM judge on the dad role (accent, Hindi, naturalness, fit). It only heard the first clause, so
every pipeline lost points for "cut off"; compare columns, not absolute values. Ears decide.

## What each stage costs

- **TTS is the biggest lever.** Gemini 3.8 TTS does not stream and has a ~1.8 s floor even for four
  words (Lite is no faster). ElevenLabs Flash v2.5, Microsoft MAI Flash, Grok and Fish Drama 3 return
  first audio in 0.35-0.5 s; Microsoft MAI-Voice-2.1 ~1.0 s.
- **Fish voice cloning keeps the chosen voice.** Drama 3 with a 6 s Algenib reference clip (16 kHz
  mp3, 62 KB base64 per request) starts in ~0.4-0.7 s and judged 9.0. Fish S2.1 Pro clones too but
  is slower (0.7-1.8 s). Fish has no preset voices on OpenRouter, so cloning is how to pin the speaker.
- **STT** ~0.65 s (`gpt-4o-mini-transcribe`), Grok STT ~0.8 s; both batch. Whisper turbo 2.4 s and
  garbles Hinglish; Nemotron "streaming" is batch here (1.5 s) and spells numbers in Devanagari.
- **LLM** time to first clause: `gemini-3.5-flash-lite` 0.74 s (reasoning `minimal`, best Hinglish),
  `gpt-4o-mini` 0.63 s (often romanizes Hindi), `gemini-2.5-flash-lite` 0.54 s (too terse, once spoke
  "[silence 1m 15s]" aloud), Claude Haiku 5.5 0.90 s, Llama 4 Scout 2-6 s. The whole reply is short,
  so streaming saves little in the LLM itself; it matters because TTS can start on the first clause.
- **Audio-in LLM** (her audio straight to Gemini, no STT): 1.3-1.8 s to first clause, no faster than
  STT + LLM and the transcript is lost. Not worth it.
- **Speech-to-speech** (`gpt-audio-mini`): fastest at 1.4 s, decent Indian delivery, but it answered a
  bare "hmm" and every silence (0/9 silent turns), invented "लालकिंकर रोड", and said it was tracking
  her ("location मैं track कर रहा हूँ"). No transcript-first control, no cached fillers, cost ~$0.01
  per turn. Revisit as a fallback, not the default.

## Turn detection (not yet measured)

Every pipeline above pays this on top. Options, cheapest first:
1. **Fixed silence (today: 800 ms).** Simple; 500 ms saves 0.3 s but cuts her off at mid-sentence pauses.
2. **Speculative start at ~300 ms of silence**: send STT + LLM immediately, hold the audio until
   ~600-700 ms of silence, cancel if she resumes. Hides most of STT+LLM behind the wait; costs wasted
   calls when she pauses mid-thought. Fits the current engine's generation counter.
3. **Semantic end-of-turn model** (e.g. a small turn-detector run in the browser on the partial
   transcript): lets the silence threshold shrink when the sentence is clearly finished ("number bata
   diya") and grow when it isn't ("aur woh..."). Needs streaming or partial STT.
4. Backchannel instead of answering: the cached "हम्म / हाँ" filler already covers slow turns.

## Recommended design for the app

`STT gpt-4o-mini-transcribe -> gemini-3.5-flash-lite streamed -> TTS per clause` with:
- `/api/reply` streaming text deltas; the client fires `/api/tts` as soon as the first clause is
  complete (`[.?!।]`, or a comma after 12+ characters, or 60 characters), then per sentence after that.
- TTS `fish-audio/drama-3` cloned from a committed Algenib reference clip for dad (keep Gemini TTS as
  a fallback and for personas without a reference yet); ~1.5 s faster than today at a similar score.
- Speculative turn detection (option 2) to bring the end-to-end median to roughly 2-2.5 s.

## Caveats

- Measured from the US. From India, each serial hop (browser -> server -> OpenRouter -> provider) adds
  round trips; the cascade has 3 hops per turn, speech-to-speech 1. Re-measure from an Indian network
  and pick a server region close to the providers.
- In the live runs the English scene used the Hinglish prompt, so replies there were Hinglish.
- Clean TTS clips are easier than a real street mic; real STT will be slower and noisier.
