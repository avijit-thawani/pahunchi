---
feature: Auto language (no picker) and more Indian languages
tags: [idea]
tests: [manual: same call, she switches Hinglish -> English -> Hindi; he follows within a line, no flip on "ok" or "हम्म"]
transcripts:
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 user asked "why not auto by default?"; deferred, picker moved under options
---

# Auto language

She never picks a language. He answers in whatever she speaks, Hindi, English, Hinglish, later Tamil, Bengali and others, and stays in it the way a real relative would.

## How it works today

The Home picker (Hinglish, Hindi, English) sets one `language` per call, and it goes to three places:

| Step | What `language` changes | Hinglish | Hindi | English |
|---|---|---|---|---|
| Her speech -> text, Sarvam `saaras:v4` (`server/api.ts` `stt`) | `language_code` | `hi-IN` | `hi-IN` | `en-IN` |
| His reply, `google/gemini-3.5-flash-lite` (`server/prompt.ts`) | language rules in the system prompt | Hindi in Devanagari + English words in Latin | Devanagari | Indian English, max one Hindi word |
| His voice, Sarvam Bulbul v4 Flash (`api.ts` `tts`) | `target_language_code` | `hi-IN` | `hi-IN` | `en-IN` |

So Hinglish and Hindi differ only in the prompt; the ears and the voice are the same. Fillers ("हम्म") are per language in `src/lib/call.ts`.

## Proposed design (no tool call needed)

1. **Ears:** send `language_code=unknown`. Sarvam then auto-detects and returns `language_code` + `language_probability` with each transcript, free, in the same request.
2. **Sticky call language:** starts at her last call's language (else Hinglish) and switches only on a confident line (e.g. probability >= 0.8 and 3+ words), so "ok" or "हम्म" never flips Papa into English.
3. **Brain:** one prompt rule, "reply in the language she uses; if she mixes Hindi and English, mix the same way". Hindi vs Hinglish becomes mirroring, not a setting.
4. **Voice:** pick `target_language_code` from the reply's script (Devanagari -> `hi-IN`, Tamil script -> `ta-IN`, Latin only -> `en-IN`). A tool call or `<lang>` tag from the LLM was considered: it adds latency to a streamed reply and the script already says the same thing.
5. **UI:** Home shows no language picker; Advanced keeps a manual override. Same on web and Android, since steps 1-4 run on the server.

## More languages

- Sarvam STT: 22 Indian languages + English. Bulbul TTS: 11 (Hindi, English, Bengali, Gujarati, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu).
- Native v4 Flash voices are thin: 3-9 per language for Bengali, Gujarati, Kannada, Marathi, Punjabi, Tamil, Telugu; Tamil's are all male; none for Malayalam or Odia (Bulbul v3's multilingual speakers could cover them). Each role needs two voices per language, cast in the voice lab.
- Each language needs its prompt rules, fillers and the smoke-call lines.

## Open questions

- Latency and accuracy of `unknown` vs `hi-IN` on her short lines; forced `hi-IN` today writes English lines in Devanagari ("आई जस्ट गॉट इनटू द कैब", see `the-call.md`), which auto may fix.
- Is a relative switching language mid-call believable, or should it lock after the first few lines?

## Notes

- 2026-11-07 card created from the user's question; nothing built.
