// API handlers in web-standard Request -> Response form. vite.config.ts (dev) and
// netlify/functions/api.ts (deployed) both call `handle`, which adds caps and logging.

import { persona } from '../shared/personas.ts'
import type { ReplyRequest, ReplyResponse, SttResponse } from '../shared/api.ts'
import { SILENT } from '../shared/api.ts'
import { CallLog, collect, pcmToWav } from './log.ts'
import { clientIp, overLimit } from './limits.ts'
import { systemPrompt } from './prompt.ts'

const BASE = 'https://openrouter.ai/api/v1'
const LLM_MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'
const STT_MODEL = process.env.PHONEY_STT_MODEL || 'openai/gpt-4o-mini-transcribe'
const TTS_MODEL = process.env.PHONEY_TTS_MODEL || 'google/gemini-3.8-flash-tts'
const MAX_TTS_CHARS = 400
const MAX_AUDIO_BYTES = 5_000_000
const MAX_LOG_BYTES = 200_000
const PCM_RATE = 24000

type Handler = (req: Request, log: CallLog) => Promise<Response>

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'phoney' }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function upstreamError(label: string, r: Response, log: CallLog): Promise<Response> {
  const text = (await r.text()).slice(0, 300)
  console.error(`[api] ${label} HTTP ${r.status}: ${text}`)
  log.event({ kind: 'error', api: label, status: r.status, detail: text })
  return json({ error: `${label} failed (${r.status})` }, 502)
}

// POST raw audio bytes (Content-Type audio/wav, audio/webm, ...) -> { text }
export async function stt(req: Request, log: CallLog): Promise<Response> {
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length || buf.length > MAX_AUDIO_BYTES) return json({ error: 'bad audio size' }, 400)
  const format = (req.headers.get('Content-Type') || 'audio/wav').split('/')[1].split(';')[0]
  log.file(`${log.turn}_her.${format}`, buf, `audio/${format}`)
  const t0 = Date.now()
  const r = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: STT_MODEL,
      input_audio: { data: Buffer.from(buf).toString('base64'), format },
    }),
  })
  if (!r.ok) return upstreamError('stt', r, log)
  const data = await r.json()
  const out: SttResponse = { text: (data.text || '').trim(), ms: Date.now() - t0, model: STT_MODEL }
  log.event({ kind: 'stt', text: out.text, ms: out.ms, model: STT_MODEL, bytes: buf.length })
  return json(out)
}

// POST ReplyRequest -> { text } (text === SILENT means stay quiet)
export async function reply(req: Request, log: CallLog): Promise<Response> {
  const body = (await req.json()) as ReplyRequest
  const p = persona(body.personaId)
  const messages = [
    { role: 'system', content: systemPrompt(p, body.name || p.defaultName, body.language) },
    ...body.turns.slice(-30).map((t) => ({
      role: t.who === 'them' ? 'assistant' : 'user',
      content: t.who === 'event' ? `[${t.text}]` : t.text,
    })),
  ]
  const t0 = Date.now()
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: 120,
      temperature: 0.8,
      reasoning: { effort: 'minimal' },
    }),
  })
  if (!r.ok) return upstreamError('reply', r, log)
  const data = await r.json()
  let text: string = (data.choices?.[0]?.message?.content || '').trim()
  text = text.replace(/^["“]|["”]$/g, '').trim()
  if (!text || /^[.…\s]+$/.test(text)) text = SILENT
  const out: ReplyResponse = { text, ms: Date.now() - t0, model: LLM_MODEL }
  log.event({
    kind: 'reply', text, ms: out.ms, model: LLM_MODEL, persona: p.id, language: body.language,
    after: body.turns.at(-1)?.text, usage: data.usage,
  })
  return json(out)
}

// POST { personaId, text } -> raw 24 kHz 16-bit mono PCM
export async function tts(req: Request, log: CallLog): Promise<Response> {
  const { personaId, text } = (await req.json()) as { personaId: string; text: string }
  if (!text || text.length > MAX_TTS_CHARS) return json({ error: 'bad text length' }, 400)
  const p = persona(personaId)
  const t0 = Date.now()
  const r = await fetch(`${BASE}/audio/speech`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: TTS_MODEL, input: text, voice: p.voice, instructions: p.style, response_format: 'pcm',
    }),
  })
  if (!r.ok || !r.body) return upstreamError('tts', r, log)
  const headersMs = Date.now() - t0
  const [toClient, toLog] = r.body.tee()
  const done = collect(toLog, t0)
  log.file(`${log.turn}_him_${Date.now()}.wav`, done.then((d) => pcmToWav(d.bytes, PCM_RATE)))
  void done.then((d) => log.event({
    kind: 'tts', text, model: TTS_MODEL, voice: p.voice, headersMs, firstByteMs: d.firstMs, totalMs: d.totalMs,
    bytes: d.bytes.length, seconds: +(d.bytes.length / 2 / PCM_RATE).toFixed(2),
  }), () => undefined)
  return new Response(toClient, {
    headers: {
      'Content-Type': 'audio/pcm',
      'X-Sample-Rate': String(PCM_RATE),
      'X-Upstream-Ms': String(headersMs),
      'X-Model': TTS_MODEL,
    },
  })
}

// POST { kind: 'start' | 'end', ... } from the client: session summaries, saved as JSON.
export async function logSession(req: Request, log: CallLog): Promise<Response> {
  const raw = await req.text()
  if (raw.length > MAX_LOG_BYTES) return json({ error: 'too large' }, 413)
  const body = JSON.parse(raw) as { kind?: string }
  const kind = body.kind === 'start' ? 'start' : 'end'
  const record = {
    ...body, receivedAt: new Date().toISOString(), ip: clientIp(req),
    userAgent: req.headers.get('User-Agent'), models: { llm: LLM_MODEL, stt: STT_MODEL, tts: TTS_MODEL },
  }
  log.file(kind === 'start' ? 'start.json' : 'session.json', new TextEncoder().encode(JSON.stringify(record, null, 2)),
    'application/json')
  log.event({ kind: `session-${kind}` })
  return json({ ok: true })
}

export const handlers: Record<string, Handler> = { stt, reply, tts, log: logSession }

/** Route /api/<name>; `defer` keeps background log writes alive after the response. */
export async function handle(name: string, req: Request, defer: (p: Promise<unknown>) => void): Promise<Response> {
  const log = new CallLog(req, defer)
  const limited = overLimit(req)
  if (limited) {
    log.event({ kind: 'error', api: name, status: 429, detail: limited })
    return json({ error: limited }, 429)
  }
  const handler = handlers[name]
  if (!handler) return json({ error: 'not found' }, 404)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    return await handler(req, log)
  } catch (e) {
    console.error('[api]', name, e)
    log.event({ kind: 'error', api: name, status: 500, detail: String(e).slice(0, 300) })
    return json({ error: 'server error' }, 500)
  }
}
