---
feature: Location sharing during calls
tags: [prod-web, dev-android]
tests: []
transcripts:
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 screenshots; web marked untested after the user's failed try
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - 1ca07d40-cbeb-406f-b581-a5608a34f146 2026-11-06 toggle, background tracking on Android, contact's map view
---

# Location sharing

An opt-in "Share my location during calls" toggle. Contacts see a map with her trail, last position and
"Open in Maps", under the same delay rule as calls. Sharing stops at hang-up.

## Screenshots

<img src="media/location-sharing-contact-map.png" width="180" alt="Contact's History: map with her trail, last location, Open in Maps">
<img src="media/location-sharing-android-toggle.png" width="180" alt="Settings toggle on Android">
<img src="media/location-sharing-android-notification.png" width="180" alt="Android notification while sharing">
<img src="media/trusted-contacts-web.png" width="180" alt="Web toggle, with the on-screen-only note">

1: what a contact sees in History (web, demo data, 2026-11-06). 2-3: Android emulator, 2026-11-06, toggle and the background notification. 4: the web toggle (demo data, 2026-11-06). All taken before the Contacts tab became Settings.

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | toggle in `/settings`; map in the contact's `/history` | same |
| How she gets there | Settings tab, only after Google sign-in (toggle is hidden when signed out) | same |
| Differences | records only while phoney is on screen; never tested on a real browser; user's try failed | keeps going in the background with a notification (emulator only) |

## Tests

None yet. Emulator run: 11 simulated GPS points uploaded, including in the background. Map seen only with
sample data, never with a real second user.

Wanted: a web test (signed in, toggle on, browser allows location, make a call, contact sees the trail) and the
same on the Pixel.

## Log

- 2026-11-07 user's web try failed: it treated sharing as app-only. Code does have a web path
  (`navigator.geolocation` in `src/lib/location.ts`), so the cause is unknown: possibly the signed-in-only toggle,
  the browser permission, or copy. For the next agent to reproduce and fix.
- 2026-11-07 card created.
