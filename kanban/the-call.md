---
feature: The call (he answers and talks back)
tags: [prod-web, dev-web, dev-android]
tests: [smoke-call, replay]
transcripts:
  - 46387402-d07d-478b-ba09-e5d050eba0a5 2026-11-07 renamed phoney -> Pahunchi
  - 15926a89-9396-4e58-9f44-692e7b77e141 2026-11-07 committed plain-words errors to main (9d0ad3b), live on dev
  - 3773fae9-00cb-4eff-a661-5ad3ac519194 2026-11-07 smoke-call on dev: latency fails (STT), sister-voice option added
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - 1ca07d40-cbeb-406f-b581-a5608a34f146 2026-11-07 plain-words errors ("Can't reach phoney"), uncommitted
  - 9d1f26a3-25fa-46db-9ec6-8c9f33798f6e 2026-11-05 ringback only until he speaks
  - e87b319c-4741-4ced-bd0c-742711e44c3f 2026-11-05 latency re-study on Sarvam, markup stripped before TTS
  - 118812ef-4f13-4e37-89a4-a7370f8dfe05 2026-11-05 streamed reply, per-clause TTS, speculative turns (4.3 -> 2.3 s)
  - e5bd0313-890d-4bce-8dd7-436508aa35a3 2026-11-05 first live loop: mic -> STT -> LLM -> TTS, phone-band audio
---

# The call

She taps Call, hears ringback, and a relative picks up and talks with her in Hindi, English or Hinglish,
with phone-band audio and a TV in the room behind him.

## Screenshots

<img src="media/the-call-web-transcript.png" width="180" alt="Web: call with Papa, transcript open">
<img src="media/the-call-android-offline-error.png" width="180" alt="Android: plain-words error when offline">

Left: web, demo data, 2026-11-05. Right: Android emulator, 2026-11-07, the "Can't reach Pahunchi" error (not on prod yet).

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/call` | same, inside the app |
| How she gets there | Home -> Call, or the "Call" home-screen icon (`/go`) | Home -> Call |
| Differences | none known | mic keeps running in the background; not yet tested on the Pixel for > 5 min |

## Tests

- `smoke-call` (web): `node scripts/smoke-call.ts cab_night dad hinglish` completes with replies; `PHONEY_HER=sarvam:aparna_hi_customer` voices her lines in the sister's Sarvam voice instead of the lab's Gemini clips. `smoke-call short` uses her real one- to three-word lines. Passes when he opens and replies with audio; latency is logged, not a gate. Last run: dev, 2026-11-07, pass. Short lines: median 2.6 s (2.6-3.2 s), STT 1.0-1.3 s, and he stayed silent after "हम्म" and "ठीक है". Long lab lines (2-6 s): medians 3.5-4.0 s. Server-side STT (Sarvam `saaras:v4`) took 1.6-1.8 s per turn, against 0.5-1.2 s for Scribe in `docs/latency.md`. LLM first clause 0.5-0.8 s and TTS first byte 0.4-1.1 s are on target.

- `replay` (any logged call): `node scripts/replay.ts serve`, open `localhost:5199`, click a call, Replay (or click a line or the timeline); `replay-shot.mjs <id> [--video]` for a PNG (and MP4 with the call audio), `replay-shot.mjs index` for every call's step breakdown. Output in `logs/replay/` (gitignored).

## Log

- 2026-11-07 STT bake-off on the 57 real lines (`node scripts/stt-bench.ts run|serve|score`). Text ready after she stops, median (p90): Scribe v2 Realtime streaming 90 ms (119), Sarvam streaming 313 ms (354), Scribe v2 batch 387 ms (496), gpt-4o-mini-transcribe 544 ms (953), Sarvam batch `hi-IN` (today) 923 ms (1216), Sarvam `codemix` 982 ms (1228). Provisional accuracy against unchecked Gemini 4 Argon drafts: Sarvam `codemix` and Scribe v2 tie best (1.00 of 2), Sarvam `hi-IN` 0.89, both streams 0.84, gpt-4o-mini 0.60; the drafts are often wrong themselves, so wait for the user's checked transcripts. `codemix` and Scribe write English words in English letters. Streaming in the app would need the phone to stream to the STT service directly (Netlify functions can't hold a WebSocket; ElevenLabs issues single-use client tokens).
- 2026-11-07 call replays added (above). On 10 logged calls, speech-to-text is the step that differs: median 1.43 s on phones (20 turns, 0.39 s of it network) vs 0.81 s from the Mac against local dev (9 turns). The opener's phone metric is wrong (`totalMs` ~2 ms: timed from playback, not pickup), so replays use server timings for it. One reply wrote पहुँची half in Urdu script ("پہنची").
- 2026-11-07 latency regressed to ~3.5-4 s on dev, almost all from Sarvam STT (switched from Scribe in `d4d6f4a` for Hindi accuracy). Its transcripts also write English lines in Devanagari ("आई जस्ट गॉट इनटू द कैब") and heard "White Dzire" as "वाइट साइडर" once. Real calls 2026-11-05/06 (20 replied turns): median her end -> his voice 3.5 s (2.6-4.2 s); lines under 1.3 s: median 3.4 s, with STT ~1 s, LLM first clause ~0.6 s and TTS first byte 1.0-1.2 s (slower than smoke-call's 0.4-1.1 s).
- 2026-11-07 card created. Deployed to prod by hand before the dev/prod split, so no tests ran; plain-words errors not deployed yet. STT, reply and voice run on the server (Android gets those changes with each site deploy); mic, turn detection and playback run on the device.
