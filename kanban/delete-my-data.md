---
feature: Delete all my data, and where data lives
tags: [prod-web, dev-android]
tests: []
transcripts:
  - 46387402-d07d-478b-ba09-e5d050eba0a5 2026-11-07 renamed phoney -> Pahunchi
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - 677281f8-7021-4886-996b-bf89e9077fdd 2026-11-07 delete also clears scheduled Android notifications
  - b5e8f044-61bb-4837-820f-8f00e69312c9 2026-11-06 delete button in Settings, recordings moved to phoney project
---

# Delete all my data

Settings -> Your data -> "Delete all my data" removes her call recordings, scheduled calls, account and
everything on the phone. All Pahunchi data lives in the phoney Supabase project.

## Screenshots

<img src="media/delete-my-data-android-settings.png" width="180" alt="Settings tab: Your data, Delete all my data">
<img src="media/delete-my-data-android-confirm.png" width="180" alt="Confirmation: what gets deleted, Delete everything / Cancel">

Android emulator, signed out, 2026-11-07: the Settings tab, then the confirmation after tapping the button (cancelled, nothing deleted). No web screenshot yet.

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/settings` (Your data), `/privacy` | same |
| How she gets there | Settings tab | Settings tab |
| Differences | none | not checked on the Pixel |

## Tests

None yet. The recording-deletion step was run against the real bucket; the full button flow never end to end.

## Log

- 2026-11-07 card created. Live on prod; the Settings page itself is not committed yet. The deletion itself runs on the server (account function, recordings bucket); the button and clearing what's stored on the phone run on the device, so it keeps platform tags rather than `server`.
