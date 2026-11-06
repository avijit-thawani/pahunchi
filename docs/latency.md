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
| Gemini TTS Algenib (app until now) | 0.93 | 0.73 | 1.84 | 3.61 | **4.1** | 8.5 | yes |
| Microsoft MAI-Voice-2.1 Grant | 0.80 | 0.80 | 0.98 | 3.03 | 3.5 | 8.5 | yes |
| ElevenLabs Flash v2.5 brian | 1.13 | 0.75 | 0.31 | 2.21 | 2.7 | 8.6 | yes |
| **Fish Drama 3, cloned from an Algenib clip (app now)** | 0.85 | 0.74 | 0.41 | 2.11 | **2.6** | **9.0** | yes |
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

## Turn detection

Options, cheapest first: (1) fixed silence (was 800 ms; 500 ms cuts her off at mid-sentence pauses);
(2) **speculative start** (shipped, below); (3) a semantic end-of-turn model on a partial transcript
(shrink the wait when "number bata diya" is clearly finished, grow it on "aur woh..."; needs streaming
STT); (4) backchannel: the cached "हम्म / हाँ" filler already covers slow turns.

## Shipped in the app (Nov 2026)

- **Speculative turns** (`src/lib/mic.ts`, `call.ts`): at 300 ms of silence the mic hands over the
  audio so far and the app starts STT -> streamed reply -> TTS; playback waits until 600 ms of
  silence confirms the turn. If she speaks again (80 ms above threshold) the turn is withdrawn:
  requests aborted, generation counter bumped, nothing played. In a test call 3 of 5 pauses were
  mid-sentence; all were dropped during STT, so each cost one STT call.
- **Streamed reply**: `/api/reply` returns NDJSON deltas; `shared/clauses.ts` cuts the first clause
  at `[.?!।]`, a comma after 12+ characters, or ~60 characters, then whole sentences; each clause
  goes to `/api/tts` immediately. A reply of only dots (SILENT) yields no clause. Streams through the
  Netlify edge gate + function (deltas arrive spread over ~300 ms in production).
- **TTS**: dad = Fish Drama 3 cloned from `server/voices/dad-algenib.mp3`; OpenRouter honours
  `response_format: "pcm"` for Fish (16-bit mono, 44.1 kHz, `rate=` in Content-Type), so no mp3
  decoding on the client. First byte 0.34-0.5 s warm, ~1-1.5 s on a cold start. Gemini Algenib is
  the fallback (upstream error, missing reference, or no answer in 4 s), ~2.0-2.4 s.

Measured with `scripts/smoke-call.ts` (3 scenes, 8 spoken turns + 1 silent, which stayed silent);
"before" is the previous commit (old server + script), deployed numbers via the previous deploy's
permalink. Her end -> his first audio, modelled as VAD wait + STT + reply + TTS first byte:

| | Before (800 ms VAD, full reply, Gemini) | After (300/600 ms speculative, first clause, Fish) |
|---|---|---|
| Local dev server | median 4.36 s (3.9-6.1) | median **2.45 s** (1.95-3.47) |
| Netlify production | median 4.32 s (3.8-5.0) | median **2.26 s** (1.97-2.52) |

Real browser calls (headless Chrome, fake mic playing the lab clips): 2.0 / 2.2 s local, 1.9 / 2.9 s
production (the 2.9 s turn had a 1.1 s STT). Without speculation the same pipeline is ~0.3 s slower.
What's left is mostly STT (0.5-1.2 s) and the LLM's first clause (0.6-0.9 s); the reply is usually
one or two short sentences, so the first clause arrives only ~50 ms before the whole reply.

## Re-run on Sarvam (Nov 5 evening)

The app now uses Scribe v2 STT (with a `hi`/`en` hint) and Sarvam Bulbul v4 Flash dad voices streamed
as `linear16`. Same 9 turns; `live app-sarvam-sumit app-sarvam-girish scribe-fish-clone`. Rows now
record `conn`: requests reuse one connection per host (like the app's server); `COLD=1` reproduces the
earlier fresh-connection runs.

| Pipeline | Conn | STT | LLM clause | TTS 1st byte | Measured | +300 ms (app's speculative wait) |
|---|---|---|---|---|---|---|
| Sarvam sumit (app) | cold | 0.78 | 0.62 | 0.82 | 2.36 | 2.7 |
| Sarvam sumit (app) | warm | 0.58 | 0.65 | 0.39 | 1.68 | **2.0** |
| Sarvam girish (app) | warm | 0.58 | 0.59 | 0.38 | 1.60 | **1.9** |
| Fish clone, Scribe STT (control) | warm | 0.68 | 0.64 | 0.23 | 1.55 | 1.85 |

- **Connection reuse matters most for Sarvam.** Its servers are ~0.2 s away from the US; a new TLS
  connection costs ~0.5 s more before the first byte (0.85-1.05 s cold vs 0.37-0.42 s warm, across
  all 8 app voices and every codec). OpenRouter voices barely change (Fish 0.26 -> 0.23 s). Cold
  turns happen after a function cold start or an idle connection; the first opening line and fillers
  usually warm it.
- With `linear16` the first body bytes arrive ~0.2 s after the headers on a cold connection; `mp3`
  arrives with the headers. Warm, both arrive together.
- Fish stays ~0.15 s faster to first audio; Sarvam is the pick for accent, not speed.
- One reply ended in a stray `</h3>` from the LLM; the TTS input isn't sanitised for markup.

## Caveats

- Measured from the US. From India, each serial hop (browser -> server -> OpenRouter -> provider) adds
  round trips; the cascade has 3 hops per turn, speech-to-speech 1. Re-measure from an Indian network
  and pick a server region close to the providers.
- Before the Sarvam re-run, the English scene used the Hinglish prompt. It now gets the English
  prompt, but replies still come out as romanized Hinglish ("Achha, number plate bheja kya tune?").
- Clean TTS clips are easier than a real street mic; real STT will be slower and noisier. With the
  lab clips STT sometimes renders English words in Marathi-style Devanagari ("व्हाईट डिझायर आहे").
