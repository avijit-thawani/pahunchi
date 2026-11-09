---
feature: Who picks up (personas and voices)
tags: [prod-web, dev-web, server]
tests: []
transcripts:
  - 613813cb-a1b9-4e38-a49b-e93d2d04c12d 2026-11-09 default is Sister (Didi), not Dad; Home copy uses she/her for female personas
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 tagged server; dropped the web/Android table
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - 9d1f26a3-25fa-46db-9ec6-8c9f33798f6e 2026-11-05 backup voices (Smallest, Gemini) behind Sarvam
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 language and name moved into collapsed More options
  - e5bd0313-890d-4bce-8dd7-436508aa35a3 2026-11-05 voice lab, Sarvam casting, 2 voices per role, Dost/Saheli, 👍/👎
---

# Who picks up

She picks Dad, Mom, Brother, Sister or a male/female friend (shown as Papa, Mummy, Bhaiya, Didi, Dost, Saheli). Sister (Didi) is the default for Call now, scheduled calls and the call-now shortcut (`DEFAULT_PERSONA`); people who already picked someone keep their choice. Names stay the same when the language is English, since each card shows the role too. Each has two Sarvam voices, one picked at random per call and logged; after the call she can leave an optional 👍/👎 and note.

Voices, prompts and fallbacks are chosen on the server (`shared/personas.ts`, `server/api.ts`), so the Android app gets any change as soon as the site deploys. The picker on Home and the feedback after a call are the same screens on both.

## Screenshots

<img src="media/home-web.png" width="180" alt="Who picks up: Papa, Mummy, Bhaiya, Didi, Dost">
<img src="media/after-call-web.png" width="180" alt="After the call: optional thumbs up/down">

Web, demo data, 2026-11-05. The third tab has since been renamed from Contacts to Settings.

## Tests

None yet.

## Log

- 2026-11-09 default changed from Dad to Sister on `main` (dev).

- 2026-11-07 card created. Deployed to prod by hand before the dev/prod split, so no tests ran.
