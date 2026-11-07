# Agent rules for Pahunchi

Read [README.md](README.md) first: what Pahunchi is, how to run it, and the **Shipping intent** (dev vs prod, web/Android parity). This file is the user's intent plus how agents record work. Cap: 1300 words (`wc -w`); one line per paragraph or bullet, no hard wraps.

## What the user wants, in priority order

Women in India call someone, or pretend to, when walking alone or in a cab at night. Pahunchi is that call, except it talks back, and it stays free to use. Distilled from the user's own messages across this project's chats (read up to 2026-11-07). When two of these conflict, the higher one wins.

1. **A call a bystander believes.**
   - He sounds like a real Indian relative: mostly responds, sometimes asks something useful (cab plate, ETA), never nosy, fine with long silences because she may just want to scroll.
   - Latency is judged by how it feels: her last word to his first sound. Ringback lasts only until the voice is ready and stops the instant he speaks.
   - It behaves like a phone call: earpiece by default, Bluetooth headsets picked up the way WhatsApp and SIM calls do, speaker only when she taps it. Same in testing: "NO SPEAKER TURNED ON WHILE TESTING."
   - Sarvam voices first, other engines only as fallback. Two voices per role, picked at random and logged.
2. **Her safety and privacy.**
   - Trusted contacts hear right away, or only if she doesn't tap "I'm safe" in time; location follows the same delay. Records are kept in case of an investigation.
   - Pahunchi's data lives in the phoney Supabase project, nowhere else, and she can delete all of it herself.
3. **Same features and UI on web and Android.** Parity is "huge": same screen, entry point and copy on both, or the card says why not. See the parity rules below.
4. **Kanban stays current.** When your work touches a feature, update its card so the next agent and the user see where it stands.
5. **Concise, obvious UI.**
   - Never "AI slop" or verbose ("dont need any of this info"). No copy explaining what isn't built, no control that does nothing (Keypad, Add call and Hold were removed for this).
   - Show a feature only to people it applies to ("Did you reach safely?" only when she has contacts).
   - Sensible defaults, extras folded away: language auto, other options in a collapsed Advanced section.
   - Home stays home: opening the app never starts a call. One PWA plus one "call now" shortcut.
   - Scheduling is a clock button beside Call with just when and a two-way why, like cab apps.
   - Bottom tabs always visible; account and data options (delete all data) live in Settings, not on Home.
   - Mobile-first, dark/light mode (`../mandarin` is the reference). Errors in plain words ("Can't reach Pahunchi, check your internet", not "TypeError: Failed to fetch").
6. **Finish the job yourself, and verify it.**
   - Migrate, deploy to dev, commit and push to GitHub without handing steps back ("you=ai agent deploy and migrate data"; "Nothing is committed yet. wtf? push na?"). Production waits for the user.
   - Test on the user's connected Pixel over adb (wireless pairing and the `nc` relay: [kanban/android-app.md](kanban/android-app.md)), read the call logs, and show UI changes on localhost. Diagnose from logs, not guesses; report numbers, not adjectives.
   - Other chats work on Pahunchi in parallel. Read any chat the user points to, and don't undo its work.

**Later, not now:** Play Store listing, iOS app; a voice journal or listener mode, exporting just her side.

## Hands off README.md and AGENTS.md

Only a human edits these two files (helped by one designated maintainer chat). Every other agent leaves them alone, even when they go stale. If one needs a change, say so in your reply to the user.

## kanban/: one card per feature

One markdown file per feature we want to ship, e.g. `kanban/call-me-later.md`. New cards only when the user asks; [kanban/example.md](kanban/example.md) shows one shape. Write whatever helps the next reader: what the feature does, where it lives on web and Android, what's tested, what's broken. About 400 words.

Front matter: `tags:`, `tests:` (whatever covers the feature, commands or short manual checks), and `transcripts:`, where each agent that writes to the card adds `<transcript-uuid> YYYY-MM-DD <what changed>`, newest first. In Cursor the uuid is your chat's file name under the project's `agent-transcripts/`; in Claude Code, the session id. Commit the uuid only, not an absolute path.

### Tags

| Tag | Meaning |
|---|---|
| `idea` | Wanted, not yet scoped |
| `todo` | Scoped, nobody on it |
| `wip` | Someone is building it now |
| `dev-web` | On `main`, so live on the dev site, `main--pahunchi.netlify.app` |
| `prod-web` | On `prod`, so live on `pahunchi.netlify.app` |
| `dev-android` | In the debug build installed on the user's Pixel |

| `server` | Lives on the server (`/api`, Supabase), so web and Android get it from the same Netlify deploy; `dev-web`/`prod-web` then says where it's deployed, and no web/Android split is needed |

`prod-android` is for the Play Store, later. A feature can carry several, e.g. `[prod-web, dev-android]` or `[prod-web, server]`.

## Releases: dev vs prod

### Parity is the main shipping bar

A feature should exist, look and sit in the same place on web and Android. When you change it on one platform, check the other in the same task, and note any difference (and why) on its card.

### Channels

Netlify deploys from GitHub, so a release is a push, not a `netlify deploy` from a laptop.

- **Dev** (agents ship here without asking): push to `main`; Netlify deploys it to `https://main--pahunchi.netlify.app`. Android: `npm run android`, build the debug APK, install on the Pixel.
- **Check the deploy, not just the push.** After pushing, confirm Netlify built it before calling it live: `netlify api listSiteDeploys --data '{"site_id":"365083bc-c390-4322-8cc9-2eb0e2fdbb55","per_page":3}'` shows your commit as `ready`, and the site's `/assets/*.js` contain the new code. Tell the user which site has it (dev or prod) and if a deploy failed or is still building.
- **Prod**: merge `main` into `prod` (`git push origin main:prod`); Netlify deploys it to `pahunchi.netlify.app`. Only when the user says so; tell them before you do.
- Before any push to `prod`, run [docs/preprod-checklist.md](docs/preprod-checklist.md) on the dev release, web and Android side by side, and add the run to its Runs section. When a feature becomes crucial, add a short text test for it there.

## Everything else

Follow README **Conventions** (no secrets or generated audio in git, OpenRouter key stays server-side, build + lint before committing).
