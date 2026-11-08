---
feature: Trusted contacts and "I'm safe"
tags: [prod-web, dev-android]
tests: [contacts-e2e]
transcripts:
  - 3773fae9-00cb-4eff-a661-5ad3ac519194 2026-11-07 no Beta badge; copy and invite text say contacts see calls in Pahunchi (no alerts claimed)
  - a8062bec-ff8f-48b3-aad1-21b474392764 2026-11-07 "I'm safe" only when a contact is on a delay
  - 3773fae9-00cb-4eff-a661-5ad3ac519194 2026-11-07 contacts-e2e script, 11/11 pass against the phoney Supabase project
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - b5e8f044-61bb-4837-820f-8f00e69312c9 2026-11-06 contacts moved into the Settings tab
  - 1ca07d40-cbeb-406f-b581-a5608a34f146 2026-11-06 native Google sign-in via system browser + deep link
  - 9149ac6f-40c6-463b-b8dd-2cf6be13ea6e 2026-11-05 "Did you reach safely?" only for users with contacts
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 Google sign-in, invite links, delay, shared calls in History
---

# Trusted contacts

She signs in with Google and invites people by link or email. Each contact sees her calls (audio, transcript)
in their History right away, or only if she doesn't tap "I'm safe" in time. No push or email alerts yet.

## Screenshots

<img src="media/trusted-contacts-web.png" width="180" alt="Contacts list: joined and invited, delay per contact">
<img src="media/after-call-web.png" width="180" alt="After the call: I'm safe">
<img src="media/location-sharing-contact-map.png" width="180" alt="A contact sees her call in History">

Web, demo data, 2026-11-05/06. Contacts now live in the Settings tab; no screenshot of that page yet.

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/settings` (contacts), `/history`, `/join/:token`, `/after/:id` | same |
| How she gets there | Settings tab; invite link | Settings tab |
| Differences | none | invite links open in the browser, not the app; native sign-in only half tested |

## Tests

- `contacts-e2e` (server, so web and Android alike): `node scripts/contacts-e2e.ts` makes two throwaway accounts without Google and checks add contact, invite link, accept, Joined, shared call at "Right away", hidden at 30 min, no direct access to her calls, then "Delete all my data" for both. Last run: 2026-11-07, 11/11 pass, nothing left behind.
- Google sign-in itself and the Settings/History screens need a person: sign in on dev with two Google accounts.

## Log

- 2026-11-07 Removed the Beta badge and "Alerts aren't live yet". Settings now says "They can see your calls in Pahunchi, right away or only if you don't tap "I'm safe" in time." The invite message said "so you can be told if I need help", which nobody is; it now says "so you can see my calls there".

- 2026-11-07 "I'm safe" now shows only when at least one contact is on a delay; details on [after-call.md](after-call.md).
- 2026-11-07 card created. Settings rename is live on prod but not committed yet.
