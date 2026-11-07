---
feature: First visit (what phoney is for, at a glance)
tags: [todo]
tests: [fresh-home]
transcripts:
  - 73385c8a-297a-4a7b-9712-7580b89d150d 2026-11-07 created card
---

# First visit

A woman who lands on phoney for the first time should know in a few seconds the three things it does: a call to talk with while she walks or rides home, a call that gets her out of a bad date or meeting ("Get me out"), and a call that checks on her later ("Check on me"). Today only the first one is obvious.

## What she sees today

- Tagline: "Walking alone or in a cab? Call someone who actually talks back."
- A one-time "How it works" card (until her first call): pick who picks up, tap Call, an AI voice answers. Nothing about scheduled calls.
- The clock button beside Call has no label, so "Get me out" and "Check on me" only appear once she happens to tap it.
- "Hear a sample" plays only the cab demo (`public/demos/audio/cab_night.mp3`).

Earlier pass: [UX review of phoney](9149ac6f-40c6-463b-b8dd-2cf6be13ea6e) added the How it works card, sample player and mic hint.

## Proposal

Short, no explainer walls, every control does something.

1. **Three use chips replace the How it works card**, one row under the tagline, for new users only (hidden after her first call or scheduled call, like the card today). Each one does the thing:
   - **Walk home**: plays the walk sample (`walk_home.mp3`).
   - **Get out of a date**: opens the clock panel with Get me out and 5 m picked.
   - **Check on me**: opens the clock panel with Check on me picked.
2. **Label the clock**: a small "Later" under the icon, always shown.
3. **Tagline** names all three uses in one line, e.g. "A call that talks back. To walk home with, to get out of a date, or to check on you."
4. **One sample per use**: record a Get me out sample to go with the cab and walk ones.

Open questions for the user: chips only for new users or always; is "date" the right word, or "bad date / meeting".

## Where it lives

| | Web | Android |
|---|---|---|
| Screen / route | `/` (`src/pages/HomePage.tsx`, `LaterPanel` in `CallLater.tsx`) | same |
| How she gets there | first open of the site or PWA | first open of the app |
| Differences | none planned | none planned |

## Tests

- `fresh-home` (web, Android): clear `phoney.introSeen` and `phoney.sessions` in localStorage (Android: clear app data), open Home. The three uses are visible without tapping anything; each chip does what it says; after one call they're gone and the clock still reads "Later". Not run yet.

## Log

- 2026-11-07 card created from the user's ask: "get me out of bad date or check on me isn't obvious to people". Nothing built.
