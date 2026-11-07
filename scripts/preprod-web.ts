// docs/preprod-checklist.md on the web, with nobody at the keyboard: two throwaway accounts (she and
// her trusted contact, signed in without Google) drive the dev site in the video toolkit's headless
// shell. Her mic is a WAV of her short lines in the sister's Sarvam voice, so the call is real:
// STT, reply and his voice all go through the site's /api. Screenshots land in video/screens/preprod/.
//   PHONEY_URL=https://main--pahunchi.netlify.app node scripts/preprod-web.ts

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { account, remove, AUTH_KEY, type Account } from './e2e-accounts.ts'

const HEADLESS = new URL('../../scratch/ai-video/tools/headless.mjs', import.meta.url)
const { headlessShellPath } = (await import(HEADLESS.href)) as { headlessShellPath: () => string }
const require = createRequire(HEADLESS)
const puppeteer = require('puppeteer-core')

const BASE = process.env.PHONEY_URL || 'https://main--pahunchi.netlify.app'
const SHOTS = 'video/screens/preprod'
const LINES = ['हाँ, cab में हूँ।', 'बस दस मिनट।']
const HER_VOICE = 'sarvam:aparna_hi_customer'
mkdirSync(SHOTS, { recursive: true })

let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Her mic: 8 s of quiet (ringback + his hello), a line, 9 s for his reply, the next line, then quiet. */
async function micWav(): Promise<string> {
  const out = 'sim/out/lines/preprod-mic.wav'
  if (existsSync(out)) return out
  const clips: string[] = []
  for (const [i, text] of LINES.entries()) {
    const file = `sim/out/lines/preprod-her-${i}.wav`
    if (!existsSync(file)) {
      const r = await fetch(`${BASE}/api/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Phoney-Session': 'preprod-her', 'X-Phoney-Turn': '00' },
        body: JSON.stringify({ personaId: 'sister', voiceId: HER_VOICE, text, language: 'hinglish' }),
      })
      if (!r.ok) throw new Error(`tts ${r.status}`)
      const raw = `${file}.pcm`
      writeFileSync(raw, Buffer.from(await r.arrayBuffer()))
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 's16le', '-ar', r.headers.get('X-Sample-Rate') || '24000', '-ac', '1', '-i', raw, file])
    }
    clips.push(file)
  }
  const quiet = (s: number) => ['-f', 'lavfi', '-t', String(s), '-i', 'anullsrc=r=48000:cl=mono']
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...quiet(8), '-i', clips[0], ...quiet(9), '-i', clips[1], ...quiet(60),
    '-filter_complex', '[1]aresample=48000[a];[3]aresample=48000[b];[0][a][2][b][4]concat=n=5:v=0:a=1',
    '-ac', '1', '-c:a', 'pcm_s16le', out])
  return out
}

async function phone(who: Account, mic?: string) {
  const browser = await puppeteer.launch({
    executablePath: headlessShellPath(), headless: 'shell',
    args: ['--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      // the sandboxed audio service can't open a WAV under ~/Downloads, so the fake mic would be silent
      '--disable-features=AudioServiceSandbox,AudioServiceOutOfProcess',
      ...(mic ? [`--use-file-for-fake-audio-capture=${path.resolve(mic)}%noloop`] : [])],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluateOnNewDocument((key: string, session: string) => {
    if (sessionStorage.getItem('__seeded')) return
    localStorage.setItem(key, session)
    localStorage.setItem('phoney.installDismissed', '1')
    localStorage.setItem('phoney.introSeen', '1')
    sessionStorage.setItem('__seeded', '1')
  }, AUTH_KEY, JSON.stringify(who.session))
  const errors: string[] = []
  page.on('pageerror', (e: Error) => errors.push(e.message))
  return { browser, page, errors }
}

type Page = Awaited<ReturnType<typeof phone>>['page']
const text = (p: Page) => p.evaluate(() => document.body.innerText) as Promise<string>
const shot = (p: Page, name: string) => p.screenshot({ path: `${SHOTS}/${name}.png` })
const go = async (p: Page, route: string) => { await p.goto(BASE + route, { waitUntil: 'networkidle2' }); await sleep(800) }
const tap = (p: Page, selector: string) => p.locator(selector).setTimeout(10_000).click()
async function waitText(p: Page, needle: string, ms = 15_000) {
  const end = Date.now() + ms
  while (Date.now() < end) { if ((await text(p)).includes(needle)) return true; await sleep(500) }
  return false
}
type Turn = { who: string; text: string }
const lastSession = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('phoney.sessions') || '[]')[0]) as
  Promise<{ id: string; turns: Turn[] } | undefined>
const said = (s: { turns: Turn[] } | undefined, who: string) => (s?.turns ?? []).filter((t) => t.who === who && t.text.trim())

const mic = await micWav()
const her = await account('her', 'E2E Her')
const him = await account('him', 'E2E Contact')
const phones: { browser: { close(): Promise<void> } }[] = []
try {
  const add = await her.db.from('trusted_contacts').insert({ name: 'E2E Contact', delay_min: 0 }).select('invite_token').single()
  await him.db.rpc('accept_invite', { token: add.data!.invite_token })

  const a = await phone(her, mic)
  phones.push(a)
  const p = a.page

  // 2. tabs
  for (const [route, label] of [['/', 'Call'], ['/history', 'History'], ['/settings', 'Settings']]) {
    await go(p, route)
    const active = await p.evaluate(() => document.querySelector('nav a.active, nav a[aria-current="page"]')?.textContent?.trim())
    check(`tab ${label}: bar visible, ${label} highlighted`, active === label, `active: ${active}`)
    await shot(p, `tab-${label.toLowerCase()}`)
  }
  // 3. signed in (Google's own page is the one step not covered)
  check('Settings shows "Signed in as E2E Her"', await waitText(p, 'Signed in as E2E Her'))
  check('Settings lists her contact', await waitText(p, 'E2E Contact'))
  check('Settings shows her account email', await waitText(p, her.session.user.email!))
  check('her joined contact shows his account email', await waitText(p, him.session.user.email!))
  await shot(p, 'settings-signed-in')

  // 5. call now
  await go(p, '/')
  await tap(p, 'button ::-p-text(Call)')
  check('call screen: Papa, Mute, Speaker, Text', await waitText(p, 'Papa') && (await text(p)).includes('Mute') && (await text(p)).includes('Speaker'))
  await sleep(4000)
  await shot(p, 'call-connected')
  await sleep(24_000)
  await tap(p, '[aria-label="End call"]')
  const call = await lastSession(p)
  check('he opened the call', said(call, 'them').length >= 1, said(call, 'them')[0]?.text)
  check('her lines were heard', said(call, 'her').length >= 1, said(call, 'her').map((t) => t.text).join(' | '))
  check('he answered her', said(call, 'them').length >= 2, said(call, 'them').slice(1).map((t) => t.text).join(' | '))
  check('after-call asks "Did you reach safely?" (she has contacts)', await waitText(p, 'Did you reach safely?'))
  await shot(p, 'after-call')

  // 9. history
  await go(p, '/history')
  check('History lists the call', await waitText(p, 'Papa'))
  await shot(p, 'history')

  // 7. her contact sees it ("Right away")
  const b = await phone(him)
  phones.push(b)
  await go(b.page, '/history')
  check('contact sees her call under "Shared with you"', await waitText(b.page, 'E2E Her', 20_000) && (await text(b.page)).toLowerCase().includes('shared with you'))
  await shot(b.page, 'contact-shared')
  await go(b.page, '/settings')
  check('contact sees who added him, with her email', await waitText(b.page, her.session.user.email!))
  await shot(b.page, 'contact-settings')

  // 6. scheduled call (rang with Now; delivery after 5 min is a separate check)
  await go(p, '/')
  await tap(p, '[aria-label="Call me later"]')
  await tap(p, 'button ::-p-text(5m)')
  await tap(p, 'button ::-p-text(Get me out)')
  await tap(p, 'button ::-p-text(Ring me at)')
  check('pending card shows on Home', await waitText(p, 'Now'))
  await shot(p, 'scheduled-pending')
  await tap(p, 'button ::-p-text(Now)')
  await tap(p, '[aria-label="Accept"]')
  await sleep(9000)
  await shot(p, 'scheduled-call')
  await tap(p, '[aria-label="End call"]')
  await sleep(1000)
  const rung = await lastSession(p)
  check('scheduled call: he speaks first', said(rung, 'them').length >= 1 && rung?.id !== call?.id, said(rung, 'them')[0]?.text)

  check('no page errors', !a.errors.length && !b.errors.length, [...a.errors, ...b.errors].join(' | '))
} finally {
  for (const ph of phones) await ph.browser.close()
  for (const [who, acc] of [['her', her], ['him', him]] as const) {
    const r = await remove(acc)
    check(`"Delete all my data" removes ${who}`, r.ok, r.error)
  }
}
console.log(`${failed ? `\n${failed} failed` : '\nall passed'}; screenshots in ${SHOTS}/`)
process.exit(failed ? 1 : 0)
