---
feature: Deploy from GitHub to Netlify, with dev and prod releases
tags: [wip, server]
tests:
  - push to main, then a branch deploy of that commit shows up at main--phoney-call.netlify.app
  - merge main into prod, then a production deploy of that commit goes live at phoney-call.netlify.app
transcripts:
  - ce344cfd-23b5-4416-aca6-852e6b135c0b 2026-11-07 linked Netlify to GitHub: main = dev release, prod = prod release
  - a1ebdb03-7df7-4906-9901-5f652abbb468 2026-11-07 created card at the user's request
---

# Deploy from GitHub

Pushing to GitHub deploys the site on its own, so each live version matches a commit.

| Branch | Release | URL |
|---|---|---|
| `main` | dev: every push, agents ship here freely | `main--phoney-call.netlify.app` |
| `prod` | prod: only when we merge `main` into it after tests pass | `phoney-call.netlify.app` |

Prod release: run the tests of the cards going `prod-web` plus `npm run build && npm run lint`, then `git push origin main:prod` (or merge `main` into `prod`).

## How it's set up

- Netlify site `phoney-call` is linked to `avijit-thawani/phoney` through the Netlify GitHub app (same one `saras-mandarin` uses). Production branch `prod`; branch deploys only for `main`; PRs get deploy previews.
- Build settings come from `netlify.toml` (`npm run build`, `dist/`, `netlify/functions`). Env vars are unchanged.
- `netlify deploy` from a laptop still works but skips the point of this; prefer pushing.

## Status

- Linked 2026-11-07. Linking built `prod` at 5f24baf, which is older than what's live (the live deploy came from a laptop with uncommitted work, e.g. the Settings tab). So the live deploy `6aee58a4` is **locked**: new prod builds finish but don't go live.
- To finish: once the parallel chats' work is committed and on `main`, check it on the dev URL, push `main` to `prod`, then unlock (Netlify UI > Deploys > "Start auto publishing", or `netlify api unlockDeploy --data '{"deploy_id":"6aee58a42bacb5ecd7379bef"}'`).

## Notes

- The dev URL moved from `dev--phoney-call` (old `--alias dev`) to `main--phoney-call`. The old alias still serves its last manual deploy.
- 2026-11-07 README and AGENTS.md now describe this flow (maintainer chat).
- 2026-11-07 Git builds had no `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (only laptop builds read `.env`), so dev said "Accounts aren't configured". Added both on Netlify for all contexts and rebuilt `main`; dev now shows "Sign in with Google". Prod was locked to CLI deploy `6aee58a4`; unlocked 2026-11-07 09:38 ET (auto-publishing on, live site unchanged), so the next push to `prod` goes live.
- The Android app calls the live site's `/api`, so a prod release also changes server behaviour for the app.
- Each prod deploy may cost Netlify credits; dev branch deploys are free. Fewer, batched prod releases help.
