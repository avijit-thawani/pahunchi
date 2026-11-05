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

Voice lab only (`sim/`). No app yet. Findings: [docs/voices.md](docs/voices.md).

Three scripted calls (cab at night in Hinglish, walking home mostly silent, cab in
Indian English) voiced by 4 TTS providers, then mixed like a real call. Dad goes
through a 300-3400 Hz phone band with a TV room behind him; she gets cab or street
ambience. 34 voices across 9 models were auditioned and scored by an audio LLM judge.

Current picks: **Gemini 3.8 Flash TTS**, Sulafat (her) + Algenib (dad), steered by a
short style line ("Indian father in his late fifties, deep, warm, unhurried").

## Layout

```
sim/
  scenes.json   scripted calls: TTS text (Devanagari + English) and a roman transcript
  lab.py        audition -> ambience -> scenes -> mix -> page (cached, budget-guarded)
  orlib.py      OpenRouter TTS/chat client, cost ledger (sim/ledger.jsonl, gitignored)
  out/          generated audio + index.html to compare by ear (gitignored)
docs/voices.md  what was tried, scores, costs, latency, next experiments
```

## Run

```bash
uv run sim/lab.py all        # or: audition | ambience | scenes | mix | page
open sim/out/index.html      # audition tables + full calls side by side
```

Needs `OPENROUTER_API_KEY` in `phoney/.env` or the shared `../.env`, and `ffmpeg`.
Spending stops at `PHONEY_BUDGET_USD` (default $8) based on the ledger. The first full
lab run cost about $0.55.

## Roadmap

- [x] Voice lab: provider audition, scripted calls, phone-call mix
- [ ] Ear check by the owner; second audition round on the shortlist (docs/voices.md)
- [ ] Live loop prototype: mic -> STT -> LLM (persona prompt) -> streaming TTS, measure
      time from her last word to the responder's first word
- [ ] PWA shell (Vite + React + Tailwind), call screen that looks like a real call
- [ ] Supabase: auth, sessions, transcripts, trusted contacts (RLS)
- [ ] "I'm safe" timer + delayed notify (Netlify scheduled function)
- [ ] Netlify deploy

## Conventions

- Never commit secrets or generated audio; `sim/out/` and the ledger are gitignored.
- Paid calls go through `orlib` so they are logged and budget-checked.
- Hindi text for TTS is written in Devanagari (better pronunciation); keep a roman
  transcript beside it for display.
