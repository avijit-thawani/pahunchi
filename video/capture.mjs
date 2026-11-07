// Storyboard stills of every phoney screen, on demo data, from the dev server (default :5173).
// Signed-in screens fake a Supabase session: the auth token is seeded in localStorage and every
// request to the Supabase host is answered here, so nothing reaches the real project.
// Uses the headless shell from the video toolkit (../../scratch/ai-video), never a system browser.
//
//   node video/capture.mjs            # all stills -> video/screens/
//   node video/capture.mjs 12 13      # only stills whose name starts with these

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  launchMobile, waitForHttp, sleep, buttonByText, recordCDP, tapWithRipple, zoomRoot, PHONE, PHONE_ZOOMED,
} from '../../scratch/ai-video/tools/headless.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'screens')
const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const SB_REF = 'flcfwjyiohuogfescmxh'
const only = process.argv.slice(2)
fs.mkdirSync(OUT, { recursive: true })

const MIN = 60000
const now = Date.now()
const day = 86400000
const at = (daysAgo, h, m) => { const d = new Date(now - daysAgo * day); d.setHours(h, m, 0, 0); return d.getTime() }
const iso = (t) => new Date(t).toISOString()

const cabTurns = (start) => [
  ['her', 'Hello Papa? Haan, main cab mein baith gayi hoon.'],
  ['them', 'Achha beta. Kaun si gaadi hai? Number bata zara.'],
  ['her', 'White Dzire hai. DL 3C AB 4521.'],
  ['them', 'Hmm, likh liya. Toh kitni der mein pahunch jaogi?'],
  ['her', 'Bas bees-pachchees minute.'],
  ['them', 'Theek hai. Main line pe hoon, tu aaram se baith.'],
  ['event', 'silence 52s'],
  ['her', 'Papa, gate pe aa gayi.'],
  ['them', 'Shabaash. Chal andar aa ja.'],
].map(([who, text], i) => ({ who, text, at: start + i * 20000 }))

const lat = (...s) => s.map((x) => ({ totalMs: x * 1000 }))

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'priya.demo@example.com', name: 'Priya Sharma' }
const CONTACT_USER = { id: '00000000-0000-4000-8000-000000000002', email: 'ananya.demo@example.com', name: 'Ananya Sharma' }

function authToken(u) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const exp = Math.floor(now / 1000) + 30 * 86400
  const user = {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    app_metadata: { provider: 'google' }, user_metadata: { full_name: u.name }, created_at: iso(now - 30 * day),
  }
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, exp, role: 'authenticated', email: u.email })}.demo`,
    refresh_token: 'demo', token_type: 'bearer', expires_in: 30 * 86400, expires_at: exp, user,
  }
}

const BASE_SEED = {
  'phoney.settings': { personaId: 'dad', name: 'Papa', language: 'hinglish', ambience: true },
  'phoney.contacts': [],
  'phoney.installDismissed': 1,
  'phoney.sessions': [
    { id: 'demo', startedAt: now - 23 * MIN, endedAt: now, personaId: 'dad', name: 'Papa', language: 'hinglish',
      turns: cabTurns(now - 23 * MIN), metrics: lat(2.3, 2.0, 2.6) },
    { id: 's2', startedAt: at(1, 22, 41), endedAt: at(1, 22, 59), safeAt: at(1, 23, 0), personaId: 'dad', name: 'Papa', language: 'hinglish',
      turns: cabTurns(at(1, 22, 41)), metrics: lat(2.2, 1.9, 2.5) },
    { id: 's3', startedAt: at(2, 21, 5), endedAt: at(2, 21, 17), safeAt: at(2, 21, 18), personaId: 'friend_f', name: 'Saheli', language: 'hinglish',
      turns: [{ who: 'her', text: 'Haan yaar, metro se nikal gayi.', at: at(2, 21, 5) }], metrics: lat(2.3, 2.6) },
    { id: 's4', startedAt: at(4, 23, 20), endedAt: at(4, 23, 34), safeAt: at(4, 23, 35), personaId: 'mom', name: 'Mummy', language: 'hindi',
      turns: [{ who: 'her', text: 'Haan mummy, auto mein hoon.', at: at(4, 23, 20) }], metrics: lat(2.4) },
  ],
}

const CONTACT_ROWS = [
  { id: 'c1', name: 'Ananya (sister)', phone: '+91 90000 00001', email: 'ananya.demo@example.com', delay_min: 30, invite_token: 'demo1', joined_at: iso(now - 9 * day) },
  { id: 'c2', name: 'Riya (roommate)', phone: '+91 90000 00002', email: null, delay_min: 0, invite_token: 'demo2', joined_at: null },
]

const SHARED_CALL = [{
  owner_name: 'Priya Sharma', id: 'sc1', persona_name: 'Papa', started_at: iso(now - 58 * MIN), ended_at: iso(now - 35 * MIN),
  safe_at: null, delay_min: 30, turns: cabTurns(now - 58 * MIN).slice(0, 6),
}]

// her cab ride: Connaught Place -> Lajpat Nagar, a point a minute
const SHARED_PATH = [
  [28.6315, 77.2167], [28.6268, 77.2195], [28.6205, 77.2238], [28.6129, 77.2295], [28.6062, 77.2321],
  [28.5994, 77.2335], [28.5921, 77.2349], [28.5858, 77.2381], [28.5801, 77.2410], [28.5745, 77.2422],
  [28.5698, 77.2436], [28.5677, 77.2431],
].map(([lat, lng], i) => ({ at: iso(now - 58 * MIN + i * 2 * MIN), lat, lng, accuracy_m: 12 + (i % 3) * 6 }))

/** Answers for the fake Supabase backend, keyed by path suffix. */
function supabaseRoutes(viewer) {
  const contact = viewer === 'contact'
  return {
    '/rest/v1/trusted_contacts': contact ? [] : CONTACT_ROWS,
    '/rest/v1/rpc/my_people': contact
      ? [{ link_id: 'l1', owner_name: 'Priya Sharma', added_back: false }]
      : [{ link_id: 'l2', owner_name: 'Riya Mehta', added_back: true }],
    '/rest/v1/rpc/shared_calls': contact ? SHARED_CALL : [],
    '/rest/v1/rpc/shared_call_path': contact ? SHARED_PATH : [],
    '/rest/v1/rpc/invite_info': [{ owner_name: 'Priya Sharma', joined: false, mine: false }],
    '/rest/v1/calls': [],
    '/auth/v1/user': authToken(contact ? CONTACT_USER : USER).user,
  }
}

async function open({ seed = {}, viewer = null, zoomed = false } = {}) {
  const { browser, page } = await launchMobile(zoomed ? PHONE_ZOOMED : PHONE)
  if (zoomed) await zoomRoot(page, 3)
  // the headless shell always reports "denied", which shows the blocked-notifications warning
  await page.evaluateOnNewDocument(() => {
    if (window.Notification) Object.defineProperty(Notification, 'permission', { get: () => 'default' })
  })
  const store = { ...BASE_SEED, ...seed }
  if (viewer) store[`sb-${SB_REF}-auth-token`] = authToken(viewer === 'contact' ? CONTACT_USER : USER)
  await page.evaluateOnNewDocument((s) => {
    if (sessionStorage.getItem('__seeded')) return
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v))
    sessionStorage.setItem('__seeded', '1')
  }, store)
  const routes = supabaseRoutes(viewer)
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!url.host.startsWith(SB_REF)) return req.continue()
    const cors = {
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Expose-Headers': '*',
    }
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: cors })
    const key = Object.keys(routes).find((k) => url.pathname.endsWith(k))
    const body = key ? routes[key] : []
    const range = Array.isArray(body) ? { 'Content-Range': `0-${Math.max(0, body.length - 1)}/${body.length}` } : {}
    req.respond({ status: 200, headers: { ...cors, ...range }, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return { browser, page }
}

async function go(page, route, settle = 900) {
  await page.goto(BASE + route, { waitUntil: 'networkidle0' })
  await sleep(settle)
}

const save = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })

/** name -> [open options, route, optional action before the shot]. */
const STILLS = {
  '00_home_first_visit': [{ seed: { 'phoney.sessions': [] } }, '/'],
  '01_home': [{}, '/'],
  '02_call_ringing': [{}, '/call?demo=ringing'],
  '03_call_connected': [{}, '/call?demo=connected'],
  '04_call_transcript': [{}, '/call?demo=connected', async (p) => { await (await buttonByText(p, 'Text')).tap() }],
  '05_after_call': [{ viewer: 'owner' }, '/after/demo'],
  '05b_call_ended_no_contacts': [{ seed: { 'phoney.installDismissed': 0 } }, '/after/demo'],
  '06_safe': [{ viewer: 'owner' }, '/after/demo', async (p) => { await (await buttonByText(p, "I'm safe")).tap() }],
  '07_history': [{}, '/history', (p) => p.evaluate(() => { document.querySelectorAll('details')[1].open = true })],
  '08_call_later_panel': [{}, '/', async (p) => {
    await (await p.$('button[aria-label="Call me later"]')).tap()
    await sleep(300)
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  }],
  '09_home_pending': [{
    seed: { 'phoney.later': [{ id: 'l1', at: now + 12 * MIN, pushed: true,
      ring: { personaId: 'dad', name: 'Papa', language: 'hinglish', scene: { purpose: 'escape', excuse: 'unwell' } } }] },
  }, '/'],
  '10_incoming': [{}, '/incoming?id=&p=dad&n=Papa&l=hinglish&s=escape&x=unwell'],
  '11_contacts_signed_out': [{}, '/settings'],
  '12_contacts_signed_in': [{ viewer: 'owner', seed: { 'phoney.settings': { ...BASE_SEED['phoney.settings'], shareLocation: true } } }, '/settings'],
  '13_contact_history_shared': [{ viewer: 'contact', seed: { 'phoney.sessions': [] } }, '/history', async (p) => {
    await p.evaluate(() => { const d = document.querySelector('details'); if (d) d.open = true })
    await sleep(2500)
  }],
  '14_join_invite': [{ viewer: 'contact' }, '/join/demo1'],
  '15_quick_call': [{}, '/go'],
}

/** Tap feedback without the tap, for buttons that would start a real call, sign-in or push. */
async function ripple(page, handle) {
  const box = await handle.boundingBox()
  await page.evaluate((x, y) => {
    const z = parseFloat(document.documentElement.style.zoom) || 1
    const dot = document.createElement('div')
    Object.assign(dot.style, {
      position: 'fixed', left: `${x / z - 22}px`, top: `${y / z - 22}px`, width: '44px', height: '44px',
      borderRadius: '50%', background: 'rgba(20,20,20,0.28)', border: '2px solid rgba(255,255,255,0.9)',
      zIndex: 2147483647, pointerEvents: 'none', transition: 'transform 450ms ease-out, opacity 450ms ease-out',
    })
    document.body.appendChild(dot)
    requestAnimationFrame(() => { dot.style.transform = 'scale(1.6)'; dot.style.opacity = '0' })
    setTimeout(() => dot.remove(), 600)
  }, box.x + box.width / 2, box.y + box.height / 2)
}

const byLabel = (page, label) => page.$(`button[aria-label="${label}"]`)

/** A recorded take as a demo script: her line shows once STT would have it, his as he starts. */
function takeScript(take, ringMs, startAt) {
  const heard = Object.fromEntries(take.turns.filter((t) => t.who === 'her').map((t) => [t.file, t.heard]))
  const texts = take.turns.filter((t) => t.who === 'them' && t.file).map((t) => t.text)
  let k = 0
  const turns = take.timeline.map((e) => e.who === 'her'
    ? { who: 'her', text: heard[e.file], atMs: Math.round(e.end * 1000 + 600) }
    : { who: 'them', text: texts[k++], atMs: Math.round(e.start * 1000) })
  return { startAt, ringMs, turns: turns.sort((a, b) => a.atMs - b.atMs) }
}

const TAKES = path.join(HERE, 'audio', 'takes')
const readTake = (id) => JSON.parse(fs.readFileSync(path.join(TAKES, id, 'take.json'), 'utf8'))

/** Scripted call recording; writes <name>.json with where pick-up lands in the clip (seconds). */
async function recCall(name, takeId, ringMs) {
  const take = readTake(takeId)
  const { browser, page } = await open({ zoomed: true })
  await go(page, '/', 300)
  const startAt = Date.now() + 2500
  await page.evaluate((s) => localStorage.setItem('phoney.demoScript', JSON.stringify(s)), takeScript(take, ringMs, startAt))
  await go(page, '/call?demo=script', 300)
  const recStart = Date.now()
  const length = take.timeline.at(-1).end * 1000 + 1200
  const r = await recordCDP(page, path.join(REC, `${name}.mp4`), async () => {
    await sleep(Math.max(0, startAt + ringMs - 400 - Date.now()))
    await tapWithRipple(page, await buttonByText(page, 'Text'))
    await sleep(Math.max(0, startAt + ringMs + length - Date.now()))
  })
  fs.writeFileSync(path.join(REC, `${name}.json`), JSON.stringify({ take: takeId, ringStart: (startAt - recStart) / 1000, pickup: (startAt + ringMs - recStart) / 1000 }))
  await browser.close()
  return r
}

const REC = path.join(HERE, 'screens', 'rec')
const RECORDINGS = {
  r01_home: async () => {
    const { browser, page } = await open({ zoomed: true, seed: { 'phoney.sessions': [] } })
    await go(page, '/')
    const r = await recordCDP(page, path.join(REC, 'r01_home.mp4'), async () => {
      await sleep(1400)
      const picks = await page.$$('button.pick')
      await tapWithRipple(page, picks[1]); await sleep(700)
      await tapWithRipple(page, picks[0]); await sleep(800)
      await ripple(page, await buttonByText(page, 'Call')); await sleep(700)
    })
    await browser.close()
    return r
  },
  r02_cab_call: () => recCall('r02_cab_call', 'cab-2', 2600),
  r03_safe: async () => {
    const { browser, page } = await open({ zoomed: true, viewer: 'owner' })
    await go(page, '/after/demo', 1500)
    const r = await recordCDP(page, path.join(REC, 'r03_safe.mp4'), async () => {
      await sleep(1300)
      await tapWithRipple(page, await buttonByText(page, "I'm safe")); await sleep(2200)
    })
    await browser.close()
    return r
  },
  r04_signin: async () => {
    const { browser, page } = await open({ zoomed: true })
    await go(page, '/settings')
    const r = await recordCDP(page, path.join(REC, 'r04_signin.mp4'), async () => {
      await sleep(1300)
      await ripple(page, await buttonByText(page, 'Sign in with Google')); await sleep(800)
    })
    await browser.close()
    return r
  },
  r05_later: async () => {
    const { browser, page } = await open({ zoomed: true })
    await go(page, '/')
    const r = await recordCDP(page, path.join(REC, 'r05_later.mp4'), async () => {
      await sleep(1000)
      await tapWithRipple(page, await byLabel(page, 'Call me later')); await sleep(900)
      await tapWithRipple(page, await buttonByText(page, '15m')); await sleep(600)
      await tapWithRipple(page, await buttonByText(page, 'Get me out')); await sleep(700)
      for (const b of await page.$$('button')) {
        if ((await b.evaluate((el) => el.innerText.trim())).startsWith('Ring me')) { await ripple(page, b); break }
      }
      await sleep(800)
    })
    await browser.close()
    return r
  },
  r06_incoming: async () => {
    const { browser, page } = await open({ zoomed: true })
    await go(page, '/incoming?id=&p=dad&n=Papa&l=hinglish&s=escape&x=unwell')
    const r = await recordCDP(page, path.join(REC, 'r06_incoming.mp4'), async () => {
      await sleep(2200)
      await ripple(page, await byLabel(page, 'Accept')); await sleep(500)
    })
    await browser.close()
    return r
  },
  r07_escape_call: () => recCall('r07_escape_call', 'escape-4', 0),
  r08_go: async () => {
    const { browser, page } = await open({ zoomed: true })
    await go(page, '/go')
    const r = await recordCDP(page, path.join(REC, 'r08_go.mp4'), async () => { await sleep(2500) })
    await browser.close()
    return r
  },
}

await waitForHttp(BASE)
if (process.argv.includes('--rec')) {
  fs.mkdirSync(REC, { recursive: true })
  const names = only.filter((x) => x !== '--rec')
  for (const [name, fn] of Object.entries(RECORDINGS)) {
    if (names.length && !names.some((p) => name.startsWith(p))) continue
    try {
      console.log('rec', name, await fn())
    } catch (e) {
      console.log('FAILED', name, e.message)
    }
  }
  process.exit(0)
}
for (const [name, [opts, route, action]] of Object.entries(STILLS)) {
  if (only.length && !only.some((p) => name.startsWith(p))) continue
  const { browser, page } = await open(opts)
  try {
    await go(page, route, opts.viewer ? 1500 : 900)
    if (action) { await action(page); await sleep(600) }
    await save(page, name)
    console.log('still', name)
  } catch (e) {
    console.log('FAILED', name, e.message)
  } finally {
    await browser.close()
  }
}
