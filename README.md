<!-- META RULE: cap this file at 150 lines. It is a working map for humans and
     agents, not a manual. If `wc -l README.md` exceeds 150, rephrase or truncate
     rather than append: tighten prose, delete what has stopped being true, or
     move a section into docs/ and link it from here. Check before every commit.
     Sibling docs carry their own caps. -->

# phoney (tentative name)

A fake phone call that talks back. In India many women call someone, or pretend to,
when walking alone or riding in a cab at night. phoney places a call to an AI "dad",
"mom", "brother" or "friend" who answers in a natural Indian voice (Hindi, English or
Hinglish), reacts like a real person, and keeps quiet when she just wants to scroll.

Free to use. Stack: React PWA + Supabase + Netlify + OpenRouter (one key for the LLM,
speech-to-text and text-to-speech), same as `../mandarin`.

## The call

- Pick who answers: male/female, parent/sibling/friend. Language: Hindi, English,
  Hinglish, all with Indian accents (more languages later).
- The responder mostly responds. Sometimes it asks something useful, like a person would:
  "gaadi ka number bata zara" when she mentions a cab, "haan, location share aa gaya",
  "toh kitni der mein pahunch jaogi?". It is not nosy and is fine with long silences.
- Realism: phone-band audio, their room in the background (TV, fan), natural pauses.
  Prompts get tuned later; the bar is "a bystander believes it".

## Safety features (order to be decided)

- **Trusted contacts.** Notify them immediately or only after a delay. The delayed
  mode is for when she does not want to disturb anyone: like Google's inactive-account
  manager, data is released only if she does not tap **"I'm safe"** in time.
- **Gentle nudge.** If a session goes quiet, contacts get "a call was started, please
  check on her", with the call audio, transcript, and anything she mentioned (cab
  plate, route).
- **Location sharing**, later, if needed.
- **Records retained** for a possible investigation, even after "I'm safe".

Later: make the call time useful in itself, e.g. a free-form voice journal or a listener.
Transcripts can drop the AI side and export just her journal.

## Status

Local web app (no Supabase/Netlify yet) with a working live call, plus the voice lab.

- **Call loop:** ringback -> responder picks up -> her speech is detected in the browser
  (energy VAD, 800 ms end-of-turn) -> STT `openai/gpt-4o-mini-transcribe` -> reply
  `google/gemini-3.5-flash-lite` (reasoning `minimal`) -> TTS `google/gemini-3.8-flash-tts`,
  one request per sentence -> played through a phone-band filter with a TV room behind.
  A cached "हम्म / हाँ" plays if the reply is slow. Long silences ask the model, which
  usually stays quiet. Mic is ignored while the responder talks (no barge-in yet).
- **Latency:** about 4-5 s from the end of her speech to his first word (VAD 0.8 s, STT
  ~1 s, LLM ~0.8 s, TTS first sentence ~1.5-2 s; Gemini TTS does not stream).
- **Cost:** voice (Algenib) is $0.0136 per minute of him talking; a busy call is
  roughly $0.01/min all-in, a mostly-silent one far less.
- **Screens:** pick responder + language, a dialer-style call screen (hidden transcript
  with per-turn latency), "I'm safe" after the call, history, trusted contacts (stored
  locally; alerts need the backend).
- **Voice lab** (`sim/`): 34 voices across 9 TTS models auditioned; picks are Sulafat (her,
  for simulations) and Algenib (dad). Findings: [docs/voices.md](docs/voices.md).

Voices other than dad (mom, siblings, friends) are untested guesses in
`shared/personas.ts`. A PWA in the background (she switches apps to scroll) may lose
mic/audio, especially on iOS; may need a native wrapper later.

## Layout

```
src/            React app: pages/, lib/call.ts (call loop), audio.ts (phone chain,
                ringback, PCM playback), mic.ts (VAD -> WAV), store.ts (localStorage)
server/         API handlers as Request -> Response (Netlify-ready): stt, reply, tts;
                prompt.ts = responder system prompt
shared/         personas (voice, style) and API types used by both sides
scripts/        smoke-call.ts: a headless call through the dev server using lab clips
sim/            voice lab: scenes.json, lab.py, orlib.py; out/ + ledger gitignored
docs/voices.md  TTS findings, scores, costs, latency
```

## Run

```bash
npm install
npm run dev                  # http://localhost:5173, /api/* served by vite.config.ts
npm run dev:phone            # HTTPS on the LAN so a phone can use the mic
node scripts/smoke-call.ts cab_night dad hinglish   # headless check, dev server running
uv run sim/lab.py all        # voice lab (needs ffmpeg); open sim/out/index.html
```

Needs `OPENROUTER_API_KEY` in `phoney/.env` or the shared `../.env` (server-side only).
Models are overridable with `PHONEY_LLM_MODEL`, `PHONEY_STT_MODEL`, `PHONEY_TTS_MODEL`.
The lab stops at `PHONEY_BUDGET_USD` (default $8); the app's calls are not budgeted.

## Roadmap

- [x] Voice lab: provider audition, scripted calls, phone-call mix
- [x] Live loop: mic -> STT -> LLM -> TTS, latency shown per turn
- [x] PWA shell (Vite + React + Tailwind/daisyUI), dialer-style call screen
- [ ] Try it on a phone; tune VAD thresholds, prompt, filler frequency
- [ ] Cut latency: shorter VAD tail, Lite TTS for the first sentence, barge-in
- [ ] Audition voices for mom / siblings / friends
- [ ] Rate-limit /api before any public deploy (the key pays for every request)
- [ ] Supabase: auth, sessions, transcripts, trusted contacts (RLS)
- [ ] "I'm safe" timer + delayed notify (Netlify scheduled function)
- [ ] Netlify deploy

## Conventions

- Never commit secrets or generated audio; `sim/out/` and the ledger are gitignored.
- Lab paid calls go through `orlib` so they are logged and budget-checked.
- The OpenRouter key stays server-side (`server/`); the browser only calls `/api/*`.
- Before committing: `npm run build && npm run lint`, and `wc -l README.md` <= 150.
- Hindi text for TTS is written in Devanagari (better pronunciation); keep a roman
  transcript beside it for display.
