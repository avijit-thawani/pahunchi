---
feature: Call me later ("Get me out" / "Check on me")
tags: [prod-web, dev-web, dev-android]
tests: []
transcripts:
  - 15926a89-9396-4e58-9f44-692e7b77e141 2026-11-07 committed the Android local-notification work to main (9d0ad3b), dev web build carries it
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - 677281f8-7021-4886-996b-bf89e9077fdd 2026-11-07 Android: phone schedules a local notification, uncommitted
  - 46387402-d07d-478b-ba09-e5d050eba0a5 2026-11-05 built it: clock button beside Call, Web Push, /incoming
---

# Call me later

A clock button beside Call opens an inline panel: when (5m-1h or a time) and a two-way toggle, Get me out or
Check on me. At that time he rings her and speaks first.

## Screenshots

<img src="media/call-me-later-web-panel.png" width="180" alt="Clock panel: when, Get me out / Check on me">
<img src="media/call-me-later-android-notification.png" width="180" alt="Android: Incoming call notification">
<img src="media/call-me-later-android-incoming.png" width="180" alt="Incoming call screen">

Left: web, demo data, 2026-11-05. Middle and right: Android emulator, 2026-11-07: the notification, then the incoming screen after tapping it.

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/` (clock panel), `/incoming` | same |
| How she gets there | Home -> clock button | Home -> clock button |
| Differences | Web Push; iPhone needs Add to Home Screen | local notification (no Web Push in the WebView); plain notification, not a ringing screen; exact-alarm permission prompt unexplained; "app fully closed" untested |

## Tests

None yet. Emulator: a scheduled call rang on time and opened `/incoming`.

## Log

- 2026-11-07 card created. Android change is on the Pixel build but not committed.
