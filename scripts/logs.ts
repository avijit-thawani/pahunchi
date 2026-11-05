// Inspect call logs (see server/log.ts for the layout).
//   node scripts/logs.ts                   list local sessions (logs/calls/)
//   node scripts/logs.ts <id|latest>       timeline of one session: transcript, timings, errors
//   node scripts/logs.ts --remote          list deployed sessions (Supabase Storage)
//   node scripts/logs.ts --remote <id>     download one into logs/calls/<id>/, then show it
// --remote reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from phoney/.env (never printed).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = 'logs/calls'
const BUCKET = 'phoney-logs'
const args = process.argv.slice(2)
const remote = args.includes('--remote')
const id = args.find((a) => !a.startsWith('--'))

type Ev = { at: string; kind: string; turn?: string; [k: string]: unknown }

function env(name: string): string {
  if (process.env[name]) return process.env[name]!
  for (const f of ['.env', '../.env']) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m?.[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error(`${name} is not set in phoney/.env`)
}

async function storage(method: string, p: string, body?: object): Promise<Response> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY')
  const r = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/${p}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`storage ${r.status}: ${await r.text()}`)
  return r
}

const list = async (prefix: string): Promise<{ name: string; id: string | null }[]> =>
  (await storage('POST', `list/${BUCKET}`, { prefix, limit: 1000, sortBy: { column: 'name', order: 'desc' } })).json()

async function download(sid: string) {
  const dir = path.join(ROOT, sid)
  mkdirSync(dir, { recursive: true })
  const events: Ev[] = []
  for (const f of await list(`${sid}/events/`)) {
    events.push(await (await storage('GET', `${BUCKET}/${sid}/events/${f.name}`)).json())
  }
  events.sort((a, b) => a.at.localeCompare(b.at))
  writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  for (const f of await list(`${sid}/`)) {
    if (!f.id) continue
    const bytes = new Uint8Array(await (await storage('GET', `${BUCKET}/${sid}/${f.name}`)).arrayBuffer())
    writeFileSync(path.join(dir, f.name), bytes)
  }
  console.log(`downloaded ${sid} -> ${dir}/\n`)
}

function show(sid: string) {
  const dir = path.join(ROOT, sid)
  const read = (f: string) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : '')
  const start = read('start.json') && JSON.parse(read('start.json'))
  const end = read('session.json') && JSON.parse(read('session.json'))
  const s = end || start
  if (s) console.log(`${sid}  ${s.personaId}/${s.language}  ${s.durationS ?? '?'} s  ${s.userAgent ?? ''}\n`)
  const events: Ev[] = read('events.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const q = (t: unknown) => JSON.stringify(t ?? '')
  for (const e of events) {
    const t = `t${e.turn ?? '??'}`.padEnd(8)
    if (e.kind === 'stt') console.log(`${t}HER    ${q(e.text)}   (stt ${e.ms} ms)`)
    else if (e.kind === 'reply') console.log(`${t}THEM   ${q(e.text)}   (llm ${e.ms} ms)`)
    else if (e.kind === 'tts') console.log(`${t}  tts  ${e.seconds}s audio, first byte ${e.firstByteMs} ms, done ${e.totalMs} ms`)
    else if (e.kind === 'error') console.log(`${t}ERROR  ${e.api} ${e.status} ${e.detail}`)
    else console.log(`${t}${e.kind}`)
  }
  if (end?.metrics?.length) {
    console.log('\nturn  speech  vad   stt   llm  tts1st  tts  her-end->his-voice (ms)')
    for (const m of end.metrics) {
      const c = (v: unknown) => String(v ?? '-').padStart(5)
      console.log(`${String(m.turn ?? '-').padEnd(5)}${c(m.speechMs)} ${c(m.vadMs)} ${c(m.sttMs)} ${c(m.llmMs)} ${c(m.ttsFirstByteMs)} ${c(m.ttsMs)} ${c(m.totalMs)}`)
    }
  }
  for (const e of end?.events ?? []) if (e.kind !== 'filler') console.log(`client: t${e.turn ?? '-'} ${e.kind} ${e.detail ?? ''}`)
  console.log(`\naudio: ${readdirSync(dir).filter((f) => f.endsWith('.wav')).length} wav files in ${dir}/`)
}

if (remote && !id) {
  for (const f of (await list('')).slice(0, 30)) console.log(f.name)
} else if (remote && id) {
  await download(id)
  show(id)
} else {
  const all = existsSync(ROOT) ? readdirSync(ROOT).sort().reverse() : []
  if (!id) for (const f of all.slice(0, 30)) console.log(f)
  else show(id === 'latest' ? all[0] : id)
}
