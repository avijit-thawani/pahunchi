// Headless call through the running dev server: her recorded lines (from the voice lab) go
// through /api/stt -> /api/reply -> /api/tts, timing each step like the browser does.
//   npm run dev   (in another terminal)
//   node scripts/smoke-call.ts [scene_id] [personaId] [language]

import { readFileSync, readdirSync } from 'node:fs'

const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const [scene = 'cab_night', personaId = 'dad', language = 'hinglish'] = process.argv.slice(2)
const dir = 'sim/out/lines/google-gemini-3-8-flash-tts'
const clips = readdirSync(dir).filter((f) => f.startsWith(scene) && f.includes('_girl')).sort()
if (!clips.length) throw new Error(`no lab clips for ${scene}; run: uv run sim/lab.py scenes`)

type Turn = { who: 'her' | 'them' | 'event'; text: string; at: number }
const turns: Turn[] = []

async function post(path: string, body: BodyInit, type: string) {
  const r = await fetch(`${BASE}/api/${path}`, { method: 'POST', headers: { 'Content-Type': type }, body })
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`)
  return r
}

async function respond(): Promise<{ text: string; llm: number; tts: number }> {
  let t = Date.now()
  const r = await (await post('reply', JSON.stringify({ personaId, name: 'Papa', language, turns }), 'application/json')).json()
  const llm = Date.now() - t
  turns.push({ who: 'them', text: r.text, at: Date.now() })
  if (r.text === '...') return { text: r.text, llm, tts: 0 }
  const first = r.text.match(/[^.!?।]+[.!?।]*/)?.[0] ?? r.text
  t = Date.now()
  const audio = await post('tts', JSON.stringify({ personaId, text: first }), 'application/json')
  const reader = audio.body!.getReader()
  await reader.read()
  const tts = Date.now() - t
  while (!(await reader.read()).done) { /* drain */ }
  return { text: r.text, llm, tts }
}

turns.push({ who: 'event', text: 'call connected', at: Date.now() })
const open = await respond()
console.log(`THEM  ${open.text}   (llm ${open.llm} ms, tts first audio ${open.tts} ms)`)

for (const clip of clips) {
  const t = Date.now()
  const stt = await (await post('stt', readFileSync(`${dir}/${clip}`), 'audio/wav')).json()
  const sttMs = Date.now() - t
  turns.push({ who: 'her', text: stt.text, at: Date.now() })
  console.log(`HER   ${stt.text}   (stt ${sttMs} ms)`)
  const r = await respond()
  console.log(`THEM  ${r.text}   (llm ${r.llm} ms, tts first audio ${r.tts} ms; her end -> his voice ≈ ${800 + sttMs + r.llm + r.tts} ms)`)
}
