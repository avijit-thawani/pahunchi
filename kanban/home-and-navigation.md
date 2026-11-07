---
feature: Home, tabs and home-screen install
tags: [prod-web, dev-android]
tests: []
transcripts:
  - 788d9f4a-6f44-4a75-8a48-af013253563d 2026-11-07 Android browsers get a "Pahunchi for Android" APK download in the install card; package id is now com.avijitthawani.pahunchi; signed release builds
  - 46387402-d07d-478b-ba09-e5d050eba0a5 2026-11-07 renamed phoney -> Pahunchi
  - 3773fae9-00cb-4eff-a661-5ad3ac519194 2026-11-07 Settings tab committed to main (dev)
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card from past chats
  - b5e8f044-61bb-4837-820f-8f00e69312c9 2026-11-06 third tab became Settings
  - 9149ac6f-40c6-463b-b8dd-2cf6be13ea6e 2026-11-06 UX pass; app icon opens Home, separate one-tap Call icon (/go)
  - fddab4f8-9e60-44ec-8e6a-35b44a63f790 2026-11-05 language/name/noise into collapsed More options
  - e5bd0313-890d-4bce-8dd7-436508aa35a3 2026-11-05 Saras-style look, light/dark, tabs stay visible after a call
---

# Home and navigation

Home: who picks up, Call with the clock button beside it, and a collapsed More options. Three bottom tabs:
Home, History, Settings. On the web she can add Pahunchi plus a separate one-tap "Call" icon to her home screen.

## Screenshots

<img src="media/home-web.png" width="180" alt="Web Home">
<img src="media/home-android.png" width="180" alt="Android Home">
<img src="media/home-web-quick-call.png" width="180" alt="One-tap Call icon screen (/go)">

Left: web, demo data, 2026-11-05. Middle: Android emulator, 2026-11-06, with the How it works card. Right: the one-tap "Call" icon on the web. All still show the old Contacts tab.

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/`, `/history`, `/settings`, `/go` | same tabs |
| How she gets there | site or installed PWA | app icon |
| Differences | install card and `/go` Call icon; in Android browsers the card offers the APK instead of Add to Home Screen | install card hidden in the app; long-press "Call now" shortcut status unchecked |

## Android app download (until the Play Store)

- The install card's "Pahunchi for Android" row (Android browsers only) links to `github.com/avijit-thawani/pahunchi/releases/latest/download/pahunchi.apk`, so each release must attach the APK under exactly that name.
- Package id `com.avijitthawani.pahunchi` (was `.phoney`; installs as a separate app). Sign-in needs `com.avijitthawani.pahunchi://auth` in Supabase Auth -> URL Configuration -> Redirect URLs.
- Release build: `npm run android && cd android && ./gradlew bundleRelease assembleRelease` (JDK 21). Signing reads the gitignored `android/keystore.properties`; without it the release build is unsigned. The upload key lives outside the repo on the user's laptop; losing it means no updates for sideloaded installs. Bump `versionCode` in `android/app/build.gradle` each release.

## Tests

None yet.

## Log

- 2026-11-07 First signed release (versionCode 1) launched on the emulator; Android download row checked on localhost with an Android user agent.
- 2026-11-07 Settings tab (trusted contacts + "Delete all my data") committed to `main`; `/contacts` redirects to `/settings`. Live prod already had it from the locked laptop deploy of 2026-11-06; dev had the old Contacts tab until now.
- 2026-11-07 card created.
