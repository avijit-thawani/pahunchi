---
feature: AI choice (which LLM plays the relative)
tags: [idea]
tests: [manual: none yet]
transcripts: []
---

# AI choice

Pick the LLM behind his replies on evidence. Today it is `google/gemini-3.5-flash-lite` (reasoning `minimal`), chosen without a comparison; only it has ever run.

## Candidates

- `google/gemini-3.5-flash-lite` (today)
- `google/gemma-4-31b-it`: fastest in `../sense` (0.64 s median, vision task)
- `google/gemini-3.1-flash-lite`, no thinking
- `google/gemma-4-26b-a4b-it`: cheapest in `../sense`
- Sarvam-105B: tuned for Indian languages; not on OpenRouter, Sarvam's own chat API

## How to score

Same turns for every model, from real logged calls (`logs/calls/`) plus the language cases in `scripts/lang-probe.ts`:

- **Speed:** request -> first phrase (what the call waits for), median and p90, streamed like `server/api.ts`.
- **Language:** replies in her language and script (Hindi, Hinglish, English, Tamil, Bengali, Telugu); stays put after "ok".
- **In character:** sounds like Papa/Mummy on a phone call: short, warm, not nosy, stays silent when it should. Judged by a strong model, a sample checked by the user.
- **Cost** per call minute.

## Notes

- 2026-11-07 card created at the user's request; nothing run yet.
