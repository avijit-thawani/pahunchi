// Headless call through a running server: her recorded lines (from the voice lab) go through
// /api/stt -> /api/reply (streamed) -> /api/tts on the first clause, timed like the browser does.
//   npm run dev   (in another terminal)
//   node scripts/smoke-call.ts [scene_id] [personaId] [language]
// Deployed: PHONEY_URL=https://phoney-call.netlify.app PHONEY_PASSWORD=... node scripts/smoke-call.ts
// "her end -> his voice" models the app's turn detection: the pipeline starts after PAUSE_MS of
// silence and playback waits for END_MS (speculative start), so it is max(END, PAUSE + stt + llm + tts).

import { readFileSync, readdirSync } from 'node:fs'
import { Clauses } from '../shared/clauses.ts'

const PAUSE_MS = 300
const END_MS = 600
const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const [scene = 'cab_night', personaId = 'dad', language = 'hinglish'] = process.argv.slice(2)
const dir = 'sim/out/lines/google-gemini-3-8-flash-tts'
const clips = readdirSync(dir).filter((f) => f.startsWith(scene) && f.includes('_girl')).sort()
if (!clips.length) throw new Error(`no lab clips for ${scene}; run: uv run sim/lab.py scenes`)

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

type Reply = { text: string; clause: number; reply: number; tts: number; engine: string }

/** Stream a reply; TTS the first clause the moment it is complete. Times are from the request. */
async function respond(turn: string): Promise<Reply> {
  const t0 = Date.now()
  const res = await post('reply', JSON.stringify({ personaId, name: 'Papa', language, turns }), 'application/json', turn)
  const clauses = new Clauses()
  let clause = 0
  let tts: Promise<{ tts: number; engine: string }> | undefined
  const speak = (c: string) => {
    if (tts) return
    clause = Date.now() - t0
    tts = (async () => {
      const t = Date.now()
      const audio = await post('tts', JSON.stringify({ personaId, text: c }), 'application/json', turn)
      const reader = audio.body!.getReader()
      await reader.read()
      const ms = Date.now() - t
      while (!(await reader.read()).done) { /* drain */ }
      return { tts: ms, engine: audio.headers.get('X-Engine') || '?' }
    })()
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
  return { text, clause, reply, ...t }
}

await login()
console.log(`${BASE}  session ${session}`)
turns.push({ who: 'event', text: 'call connected', at: Date.now() })
const open = await respond('00')
console.log(`THEM  ${open.text}   (first clause ${open.clause} ms, tts ${open.engine} first audio ${open.tts} ms)`)

const totals: number[] = []
for (const [i, clip] of clips.entries()) {
  const turn = String(i + 1).padStart(2, '0')
  const t = Date.now()
  const stt = await (await post('stt', readFileSync(`${dir}/${clip}`), 'audio/wav', turn)).json()
  const sttMs = Date.now() - t
  turns.push({ who: 'her', text: stt.text, at: Date.now() })
  console.log(`HER   ${stt.text}   (stt ${sttMs} ms)`)
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
const sorted = [...totals].sort((a, b) => a - b)
if (sorted.length) console.log(`\nher end -> his voice: median ${sorted[Math.floor(sorted.length / 2)]} ms over ${sorted.length} turns`
  + ` (min ${sorted[0]}, max ${sorted.at(-1)})`)
