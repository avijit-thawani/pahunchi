// Headless call through a running server: her recorded lines (from the voice lab) go through
// /api/stt -> /api/reply (streamed) -> /api/tts on the first clause, timed like the browser does.
//   npm run dev   (in another terminal)
//   node scripts/smoke-call.ts [scene_id] [personaId] [language]   (language: what the call starts in)
// Deployed: PHONEY_URL=https://pahunchi.thawani.co PHONEY_PASSWORD=... node scripts/smoke-call.ts
// PHONEY_HER=sarvam:aparna_hi_customer voices her lines (sim/scenes.json) in that voice through
// /api/tts once, cached under sim/out/lines/, instead of the lab's Gemini clips.
// PHONEY_VOICE=sarvam:kabir_hi_conversational picks his voice (default: the role's first).
// Scenes in OWN below (`short`, `en_hello`, `en_cab`, ...) carry their own lines, voiced in aparna.
// "her end -> his voice" models the app's turn detection: the pipeline starts after PAUSE_MS of
// silence and playback waits for END_MS (speculative start), so it is max(END, PAUSE + stt + llm + tts).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { Clauses } from '../shared/clauses.ts'
import { persona } from '../shared/personas.ts'

const PAUSE_MS = 300
const END_MS = 600
const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const [scene = 'cab_night', personaId = 'dad', startLanguage = 'hinglish'] = process.argv.slice(2)
/** The call's language; follows /api/stt's verdict like the app does. */
let language = startLanguage
// Her lines when the scene isn't in sim/scenes.json; voiced in aparna unless PHONEY_HER is set.
const OWN: Record<string, string[]> = {
  short: ['हाँ पापा।', 'हाँ, cab में हूँ।', 'हम्म।', 'बस दस मिनट।', 'ठीक है।'],
  // Alicia's 2026-11-19 call, word for word
  en_hello: ['Hi.', 'Hello.', 'Hello, good day.', 'Hello. Good to see you.', 'Hello.'],
  en_cab: ["Hi, I just got into the cab. I'll be home in twenty minutes.", 'Yeah, the driver seems fine.', 'Okay.', 'It is a white Swift.', 'I am almost there. Bye.'],
  en_walk: ['Hey, I am walking back from the station.', 'Ten minutes, maybe.', 'What are you doing?', 'Okay, I can see my building now.'],
  // starts English, then she goes back to Hindi
  en_then_hi: ['Hi, I am in the cab now.', 'अच्छा सुनो, मैं बस दस मिनट में पहुँच रही हूँ।', 'हाँ, ठीक है।'],
}
const HER = process.env.PHONEY_HER || (OWN[scene] ? 'sarvam:aparna_hi_customer' : undefined)
const dir = HER ? `sim/out/lines/${HER.replace(/[^\w-]+/g, '-')}` : 'sim/out/lines/google-gemini-3-8-flash-tts'

type Turn = { who: 'her' | 'them' | 'event'; text: string; at: number }
const turns: Turn[] = []
const session = `smoke-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}` // logged like a real call
let cookie = ''

async function login() {
  const password = process.env.PHONEY_PASSWORD
  if (!password) return
  const r = await fetch(`${BASE}/__login`, { method: 'POST', body: new URLSearchParams({ password }), redirect: 'manual' })
  cookie = (r.headers.get('set-cookie') || '').split(';')[0]
  if (!cookie) throw new Error(`login failed (${r.status})`)
}

async function post(path: string, body: BodyInit, type: string, turn: string) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method: 'POST', body,
    headers: { 'Content-Type': type, 'X-Phoney-Session': session, 'X-Phoney-Turn': turn, ...(cookie && { Cookie: cookie }) },
  })
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`)
  return r
}

// The whole call as one recording, one voice at a time with short gaps: logs/calls/<session>/call.wav.
// (Turns here run back to back without waiting for audio to finish, so the logged times overlap.)
const RATE = 24000
const tape: Buffer[] = []
function record(pcm: Buffer, rate: number, gapMs = 350) {
  if (rate !== RATE) return
  tape.push(pcm.subarray(0, pcm.length & ~1), Buffer.alloc(Math.round((RATE * gapMs) / 1000) * 2))
}

type Reply = { text: string; clause: number; reply: number; tts: number; engine: string }

/** Stream a reply; TTS the first clause the moment it is complete. Times are from the request. */
async function respond(turn: string): Promise<Reply> {
  const t0 = Date.now()
  const res = await post('reply', JSON.stringify({ personaId, name: persona(personaId).defaultName, language, turns }), 'application/json', turn)
  const clauses = new Clauses()
  let clause = 0
  let tts: Promise<{ tts: number; engine: string }> | undefined
  let rest: Promise<unknown> = Promise.resolve()
  /** Voice one clause; its audio goes onto the call recording in order. Returns time to first audio. */
  const voice = async (c: string) => {
    const t = Date.now()
    const audio = await post('tts', JSON.stringify({ personaId, text: c, language, voiceId: process.env.PHONEY_VOICE }), 'application/json', turn)
    const reader = audio.body!.getReader()
    const parts: Buffer[] = []
    let ms = 0
    for (;;) {
      const { done, value } = await reader.read()
      ms ||= Date.now() - t
      if (value) parts.push(Buffer.from(value))
      if (done) break
    }
    record(Buffer.concat(parts), Number(audio.headers.get('X-Sample-Rate') || 24000))
    return { tts: ms, engine: audio.headers.get('X-Engine') || '?' }
  }
  // The first clause is timed like the app; later clauses follow one at a time so they stay in order.
  const speak = (c: string) => {
    if (!tts) {
      clause = Date.now() - t0
      tts = voice(c)
      rest = tts.catch(() => undefined)
    } else rest = rest.then(() => voice(c))
  }
  let text = ''
  let buf = ''
  const dec = new TextDecoder()
  const reader = res.body!.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop()!
    for (const line of lines.filter(Boolean)) {
      const c = JSON.parse(line)
      if (c.error) throw new Error(c.error)
      if (c.d) clauses.push(c.d).forEach(speak)
      if (c.done) text = c.text
    }
  }
  clauses.flush().forEach(speak)
  const reply = Date.now() - t0
  turns.push({ who: 'them', text, at: Date.now() })
  const t = tts ? await tts : { tts: 0, engine: '-' }
  await rest
  return { text, clause, reply, ...t }
}

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** Her lines of the scene in the PHONEY_HER voice, named like the lab's clips. */
async function voiceHer() {
  const { scenes } = JSON.parse(readFileSync('sim/scenes.json', 'utf8')) as { scenes: { id: string; lines: { who: string; text: string }[] }[] }
  const lines = OWN[scene]?.map((text) => ({ who: 'girl', text })) ?? scenes.find((x) => x.id === scene)?.lines
  if (!lines) throw new Error(`no scene ${scene} in sim/scenes.json`)
  mkdirSync(dir, { recursive: true })
  for (const [i, t] of lines.entries()) {
    const file = `${dir}/${scene}_${String(i).padStart(2, '0')}_girl.wav`
    if (t.who !== 'girl' || existsSync(file)) continue
    const r = await post('tts', JSON.stringify({ personaId: 'sister', voiceId: HER, text: t.text, language: /[\u0900-\u097F]/.test(t.text) ? 'hinglish' : 'english' }), 'application/json', '00')
    writeFileSync(file, wav(Buffer.from(await r.arrayBuffer()), Number(r.headers.get('X-Sample-Rate') || 24000)))
  }
}

await login()
if (HER) await voiceHer()
const clips = readdirSync(dir).filter((f) => f.startsWith(scene) && f.includes('_girl')).sort()
if (!clips.length) throw new Error(`no lab clips for ${scene}; run: uv run sim/lab.py scenes`)
console.log(`${BASE}  session ${session}  her: ${HER ?? 'gemini lab clips'}`)
turns.push({ who: 'event', text: 'call connected', at: Date.now() })
const open = await respond('00')
console.log(`THEM  ${open.text}   (first clause ${open.clause} ms, tts ${open.engine} first audio ${open.tts} ms)`)

const totals: number[] = []
for (const [i, clip] of clips.entries()) {
  const turn = String(i + 1).padStart(2, '0')
  const t = Date.now()
  const her = readFileSync(`${dir}/${clip}`)
  record(her.subarray(44), her.readUInt32LE(24), 700)
  const stt = await (await post(`stt?lang=${language}`, her, 'audio/wav', turn)).json()
  const sttMs = Date.now() - t
  turns.push({ who: 'her', text: stt.text, at: Date.now() })
  const switched = stt.language && stt.language !== language ? `; call ${language} -> ${stt.language}` : ''
  if (stt.language) language = stt.language
  console.log(`HER   ${stt.text}   (stt ${sttMs} ms${switched})`)
  const r = await respond(turn)
  if (!r.tts) {
    console.log(`THEM  ${r.text}   (silent; reply ${r.reply} ms)`)
    continue
  }
  const pipeline = sttMs + r.clause + r.tts
  const total = Math.max(END_MS, PAUSE_MS + pipeline)
  totals.push(total)
  console.log(`THEM  ${r.text}   (first clause ${r.clause} ms, full reply ${r.reply} ms, tts ${r.engine} first audio ${r.tts} ms;`
    + ` her end -> his voice ≈ ${total} ms, or ${END_MS + pipeline} ms without speculation)`)
}
mkdirSync(`logs/calls/${session}`, { recursive: true })
writeFileSync(`logs/calls/${session}/call.wav`, wav(Buffer.concat(tape), RATE))
console.log(`\nlisten: logs/calls/${session}/call.wav`)
const sorted = [...totals].sort((a, b) => a - b)
if (sorted.length) console.log(`\nher end -> his voice: median ${sorted[Math.floor(sorted.length / 2)]} ms over ${sorted.length} turns`
  + ` (min ${sorted[0]}, max ${sorted.at(-1)})`)
