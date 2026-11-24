// A whole call through the real app in a headless browser: Home -> Call -> the call screen, with her
// lines played into the app's microphone and everything the app plays recorded (ringback, his voice
// through the phone filter, the TV behind him, fillers). Her lines wait until he has finished, as
// a person would; nothing else is scripted.
//   npm run dev   (in another terminal)
//   node scripts/browser-call.mjs <scene> <personaId> <language>   -> logs/browser-calls/<session>.wav
// Scenes are smoke-call.ts's own (en_hello, en_cab, en_walk, en_then_hi, short); run it once for a
// scene first so her clips exist under sim/out/lines/. The browser is muted; no speaker is used.

import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { headlessShellPath, PHONE } from '../../scratch/ai-video/tools/headless.mjs'

const puppeteer = createRequire(new URL('../../scratch/ai-video/tools/headless.mjs', import.meta.url))('puppeteer-core')
const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const [scene = 'en_cab', personaId = 'dad', language = 'english'] = process.argv.slice(2)
const DIR = 'sim/out/lines/sarvam-aparna_hi_customer'
const OUT = 'logs/browser-calls'
const clips = fs.readdirSync(DIR).filter((f) => f.startsWith(`${scene}_`) && f.includes('_girl')).sort()
if (!clips.length) throw new Error(`no clips for ${scene}; run: node scripts/smoke-call.ts ${scene} once`)
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: headlessShellPath(), headless: 'shell',
  args: ['--no-first-run', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage()
await page.setViewport(PHONE)
page.on('pageerror', (e) => console.log('page error:', e.message))

await page.evaluateOnNewDocument((settings) => {
  localStorage.setItem('phoney.settings', JSON.stringify(settings))
  localStorage.setItem('phoney.debug', '1')
  // The rig: its own audio context holds her "microphone" and the recorder of the whole call.
  let rig
  const get = () => {
    if (rig) return rig
    const ctx = new AudioContext()
    const mic = ctx.createMediaStreamDestination()
    const tape = ctx.createMediaStreamDestination()
    const rec = new MediaRecorder(tape.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 })
    const chunks = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.start(250)
    return (rig = { ctx, mic, tape, rec, chunks, t0: performance.now(), tapped: new WeakSet() })
  }
  navigator.mediaDevices.getUserMedia = async () => get().mic.stream
  // Whatever the app sends to its speaker also goes onto the tape.
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = get()
    if (this.context !== r.ctx && dest === this.context.destination) {
      const tap = this.context.createMediaStreamDestination()
      connect.call(this, tap)
      r.ctx.createMediaStreamSource(tap.stream).connect(r.tape)
    }
    return connect.call(this, dest, ...rest)
  }
  /** Play one of her lines into the mic (and onto the tape); resolves when it ends. */
  window.__say = async (b64) => {
    const r = get()
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const buf = await r.ctx.decodeAudioData(bytes.buffer)
    const src = r.ctx.createBufferSource()
    src.buffer = buf
    src.connect(r.mic)
    src.connect(r.tape)
    const at = (performance.now() - r.t0) / 1000
    await new Promise((done) => { src.onended = done; src.start() })
    return { at, seconds: buf.duration }
  }
  window.__tape = async () => {
    const r = get()
    await new Promise((done) => { r.rec.onstop = done; r.rec.stop() })
    const b = new Uint8Array(await new Blob(r.chunks).arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  }
}, { personaId, name: '', language, ambience: true })

const activity = () => page.evaluate(() => document.querySelector('progress')?.previousElementSibling?.textContent ?? '')
/** Wait until the app has been in `want` for `holdMs`; false on timeout. */
async function until(want, timeoutMs, holdMs = 0) {
  const end = Date.now() + timeoutMs
  let since = 0
  while (Date.now() < end) {
    if ((await activity()) === want) {
      since ||= Date.now()
      if (Date.now() - since >= holdMs) return true
    } else since = 0
    await sleep(50)
  }
  return false
}

await page.goto(BASE, { waitUntil: 'networkidle2' })
const call = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Call'))
await call.click()
await page.waitForFunction(() => location.pathname === '/call')
const text = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Text'))
await text.click()

// He picks up and says his opener; she answers once he has been quiet for a moment.
if (!(await until('speaking', 20000))) throw new Error('he never picked up')
for (const clip of clips) {
  if (!(await until('listening', 30000, 700))) throw new Error('he never stopped talking')
  const said = await page.evaluate((b64) => window.__say(b64), fs.readFileSync(`${DIR}/${clip}`).toString('base64'))
  console.log(`her line at ${said.at.toFixed(1)} s (${said.seconds.toFixed(1)} s)`)
  // He answers (speaking), or stays silent: then the app goes thinking -> listening without speaking.
  await sleep(600)
  if (!(await until('speaking', 6000))) console.log('  (he stayed quiet)')
}
await until('listening', 30000, 1200)
const transcript = await page.evaluate(() => [...document.querySelectorAll('main .space-y-1\\.5 > p')].map((p) => `${p.className.includes('sky') ? 'USER' : 'AI  '}  ${p.textContent}`))
const error = await page.evaluate(() => document.querySelector('[role=alert]')?.textContent ?? '')
const webm = Buffer.from(await page.evaluate(() => window.__tape()), 'base64')
const end = await page.evaluateHandle(() => document.querySelector('button[aria-label="End call"]'))
await end.click()
await page.waitForFunction(() => location.pathname.startsWith('/after/'))
const session = await page.evaluate(() => location.pathname.split('/').pop())
await sleep(1500) // the end-of-call log
await browser.close()

fs.writeFileSync(`${OUT}/${session}.webm`, webm)
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', `${OUT}/${session}.webm`, '-ac', '1', '-ar', '24000', `${OUT}/${session}.wav`], { encoding: 'utf8' })
if (r.status !== 0) throw new Error(r.stderr)
fs.rmSync(`${OUT}/${session}.webm`)
fs.writeFileSync(`${OUT}/${session}.txt`, transcript.join('\n') + '\n')
console.log(transcript.join('\n'))
if (error) console.log(`error shown on the call screen: ${error}`)
console.log(`\nsession ${session}\nlisten: ${OUT}/${session}.wav`)
