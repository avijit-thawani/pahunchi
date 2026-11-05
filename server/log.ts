// Call logging for debugging and iteration. Every /api request that carries an
// X-Phoney-Session header is recorded: her audio + transcript, the reply, his audio, timings,
// errors, and the client's start/end summaries. One folder per session:
//   <session>/start.json, session.json      client summaries (persona, UA, turns, metrics)
//   <session>/events.jsonl (local) or events/<ts>-<kind>.json (Supabase)
//   <session>/<turn>_her.wav, <turn>_him_<ts>.wav
// Sinks: Supabase Storage (private bucket) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// set, else local files under logs/calls/. PHONEY_LOG=local|off overrides (the dev server
// defaults to local). Logging never throws:
// every failure is caught and printed, so it cannot break a call.

import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const BUCKET = 'phoney-logs'
const SESSION_RE = /^[A-Za-z0-9_-]{6,64}$/
const TURN_RE = /^[A-Za-z0-9_-]{1,16}$/

export type LogEvent = { kind: string; turn?: string; [k: string]: unknown }

interface Sink {
  event(session: string, e: LogEvent & { at: string }): Promise<void>
  file(session: string, name: string, bytes: Uint8Array, type: string): Promise<void>
}

const localSink = (root: string): Sink => ({
  async event(session, e) {
    await mkdir(path.join(root, session), { recursive: true })
    await appendFile(path.join(root, session, 'events.jsonl'), JSON.stringify(e) + '\n')
  },
  async file(session, name, bytes) {
    await mkdir(path.join(root, session), { recursive: true })
    await writeFile(path.join(root, session, name), bytes)
  },
})

function supabaseSink(url: string, key: string): Sink {
  const put = async (objectPath: string, body: Uint8Array | string, type: string) => {
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': type, 'x-upsert': 'true' },
      body: typeof body === 'string' ? body : new Blob([body as BlobPart]),
    })
    if (!r.ok) throw new Error(`storage ${r.status}: ${(await r.text()).slice(0, 200)}`)
  }
  return {
    event: (session, e) => put(
      `${session}/events/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${e.kind}.json`,
      JSON.stringify(e), 'application/json',
    ),
    file: (session, name, bytes, type) => put(`${session}/${name}`, bytes, type),
  }
}

let sink: Sink | null | undefined
function getSink(): Sink | null {
  if (sink !== undefined) return sink
  const { PHONEY_LOG, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (PHONEY_LOG === 'off') sink = null
  else if (PHONEY_LOG !== 'local' && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    sink = supabaseSink(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  }
  else sink = localSink(path.resolve(process.env.PHONEY_LOG_DIR || 'logs/calls'))
  return sink
}

async function safe(label: string, p: () => Promise<void>) {
  try {
    await p()
  } catch (e) {
    console.error(`[log] ${label} failed:`, String(e).slice(0, 300))
  }
}

/** Per-request logger. `defer` keeps background writes alive (Netlify waitUntil). */
export class CallLog {
  readonly session: string | null
  readonly turn: string
  private defer: (p: Promise<unknown>) => void

  constructor(req: Request, defer: (p: Promise<unknown>) => void) {
    const s = req.headers.get('X-Phoney-Session') || ''
    const t = req.headers.get('X-Phoney-Turn') || ''
    this.session = SESSION_RE.test(s) ? s : null
    this.turn = TURN_RE.test(t) ? t : 'xx'
    this.defer = defer
  }

  event(e: LogEvent) {
    const s = getSink()
    if (!this.session) return
    const full = { at: new Date().toISOString(), turn: this.turn, ...e }
    const brief = Object.entries(full).filter(([k]) => k !== 'at').map(([k, v]) =>
      `${k}=${typeof v === 'string' ? JSON.stringify(v.slice(0, 80)) : JSON.stringify(v)?.slice(0, 80)}`)
    console.log(`[log] ${this.session} ${brief.join(' ')}`)
    if (s) this.defer(safe('event', () => s.event(this.session!, full)))
  }

  file(name: string, bytes: Uint8Array | Promise<Uint8Array>, type = 'audio/wav') {
    const s = getSink()
    if (!s || !this.session) return
    this.defer(safe(`file ${name}`, async () => s.file(this.session!, name, await bytes, type)))
  }
}

/** Wrap 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true)
  v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** Read a stream to the end, resolving with all bytes and the time to the first chunk. */
export async function collect(stream: ReadableStream<Uint8Array>, t0: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let firstMs = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstMs) firstMs = Date.now() - t0
    chunks.push(value)
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let o = 0
  for (const c of chunks) {
    bytes.set(c, o)
    o += c.length
  }
  return { bytes, firstMs, totalMs: Date.now() - t0 }
}
