// API handlers in web-standard Request -> Response form. vite.config.ts (dev) and
// netlify/functions/api.ts (deployed) both call `handle`, which adds caps and logging.

import { persona, type Language, type Persona, type VoiceOption } from '../shared/personas.ts'
import type { ReplyChunk, ReplyRequest, SttResponse } from '../shared/api.ts'
import { SILENT } from '../shared/api.ts'
import { Clauses, speakable } from '../shared/clauses.ts'
import { CallLog, collect, pcmToWav } from './log.ts'
import { clientIp, overLimit } from './limits.ts'
import { systemPrompt } from './prompt.ts'
import { inputReferences } from './voices.ts'

const BASE = 'https://openrouter.ai/api/v1'
const LLM_MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'
// Scribe v2 + a language hint writes her Hindi in Devanagari; gpt-4o-mini-transcribe wrote it as Urdu.
const STT_MODEL = process.env.PHONEY_STT_MODEL || 'elevenlabs/scribe-v2'
const TTS_MODEL = process.env.PHONEY_TTS_MODEL || 'google/gemini-3.8-flash-tts'
const MAX_TTS_CHARS = 400
const MAX_AUDIO_BYTES = 5_000_000
const MAX_LOG_BYTES = 200_000
const PCM_RATE = 24000
const CLONE_HEADERS_TIMEOUT_MS = 4000

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
  const language = new URL(req.url).searchParams.get('lang') === 'english' ? 'en' : 'hi'
  const t0 = Date.now()
  const r = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: STT_MODEL,
      language,
      input_audio: { data: Buffer.from(buf).toString('base64'), format },
    }),
  })
  if (!r.ok) return upstreamError('stt', r, log)
  const data = await r.json()
  const out: SttResponse = { text: (data.text || '').trim(), ms: Date.now() - t0, model: STT_MODEL }
  log.event({ kind: 'stt', text: out.text, ms: out.ms, model: STT_MODEL, language, bytes: buf.length })
  return json(out)
}

/** Yields the `data:` payloads of a server-sent-events stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += dec.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = done ? '' : lines.pop()!
    for (const line of lines) if (line.startsWith('data:')) yield line.slice(5).trim()
    if (done) return
  }
}

// POST ReplyRequest -> NDJSON stream of ReplyChunk: { d } deltas, then { done, text, ms, model }.
// Final text === SILENT means stay quiet.
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
  const upstream = new AbortController()
  req.signal?.addEventListener('abort', () => upstream.abort())
  const r = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    signal: upstream.signal,
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      max_tokens: 120,
      temperature: 0.8,
      reasoning: { effort: 'minimal' },
      stream: true,
    }),
  })
  if (!r.ok || !r.body) return upstreamError('reply', r, log)
  const upstreamBody = r.body
  const enc = new TextEncoder()
  const meta = { model: LLM_MODEL, persona: p.id, language: body.language, after: body.turns.at(-1)?.text }

  const stream = new ReadableStream<Uint8Array>({
    async start(ctl) {
      const send = (c: ReplyChunk) => ctl.enqueue(enc.encode(JSON.stringify(c) + '\n'))
      const clauses = new Clauses()
      let raw = ''
      let firstTokenMs: number | undefined
      let firstClauseMs: number | undefined
      let usage: unknown
      try {
        for await (const data of sseData(upstreamBody)) {
          if (data === '[DONE]') break
          const j = JSON.parse(data)
          if (j.error) throw new Error(`upstream: ${JSON.stringify(j.error).slice(0, 200)}`)
          if (j.usage) usage = j.usage
          const d: string = j.choices?.[0]?.delta?.content || ''
          if (!d) continue
          firstTokenMs ??= Date.now() - t0
          raw += d
          if (firstClauseMs === undefined && clauses.push(d).length) firstClauseMs = Date.now() - t0
          send({ d })
        }
        let text = raw.trim().replace(/^["“]|["”]$/g, '').trim()
        if (!text || !speakable(text)) text = SILENT
        const ms = Date.now() - t0
        if (firstClauseMs === undefined && text !== SILENT) firstClauseMs = ms
        send({ done: true, text, ms, model: LLM_MODEL })
        log.event({ kind: 'reply', text, ms, firstTokenMs, firstClauseMs, ...meta, usage })
      } catch (e) {
        if (upstream.signal.aborted) {
          log.event({ kind: 'reply-aborted', text: raw, ms: Date.now() - t0, ...meta })
        } else {
          console.error('[api] reply stream', e)
          log.event({ kind: 'error', api: 'reply', status: 502, detail: String(e).slice(0, 300), text: raw })
          try {
            send({ error: 'reply failed mid-stream' })
          } catch {
            // client already gone
          }
        }
      } finally {
        try {
          ctl.close()
        } catch {
          // already cancelled
        }
      }
    },
    cancel() {
      upstream.abort()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

type Engine = {
  name: 'sarvam' | 'clone' | 'gemini'; model: string; voice: string; timeoutMs: number
  url: string; headers: () => Record<string, string>; body: () => Promise<object>
  /** Fixed output rate; OpenRouter engines report theirs in Content-Type. */
  rate?: number
}

function keyed(name: string, header: string): () => Record<string, string> {
  return () => {
    const key = process.env[name]
    if (!key) throw new Error(`${name} is not set`)
    return { [header]: key, 'Content-Type': 'application/json' }
  }
}

function primary(v: VoiceOption, text: string, language: Language): Engine {
  return {
    name: 'sarvam', model: v.model, voice: v.speaker, timeoutMs: 4000, rate: PCM_RATE,
    url: 'https://api.sarvam.ai/text-to-speech/stream', headers: keyed('SARVAM_API_KEY', 'api-subscription-key'),
    body: async () => ({
      text, model: v.model, speaker: v.speaker, target_language_code: language === 'english' ? 'en-IN' : 'hi-IN',
      speech_sample_rate: PCM_RATE, output_audio_codec: 'linear16',
    }),
  }
}

function engines(p: Persona, text: string, language: Language, voiceId?: string): Engine[] {
  const openrouter = { url: `${BASE}/audio/speech`, headers: headers }
  const gemini: Engine = {
    ...openrouter, name: 'gemini', model: TTS_MODEL, voice: p.voice, timeoutMs: 15000,
    body: async () => ({ model: TTS_MODEL, input: text, voice: p.voice, instructions: p.style, response_format: 'pcm' }),
  }
  if (process.env.PHONEY_TTS_ENGINE === 'gemini') return [gemini]
  const list: Engine[] = []
  const v = p.voices?.find((x) => x.id === voiceId) ?? p.voices?.[0]
  if (v) list.push(primary(v, text, language))
  const clone = p.clone
  if (clone) {
    list.push({
      ...openrouter, name: 'clone', model: clone.model, voice: clone.ref, timeoutMs: CLONE_HEADERS_TIMEOUT_MS,
      body: async () => ({ model: clone.model, input: text, response_format: 'pcm', input_references: await inputReferences(clone) }),
    })
  }
  return [...list, gemini]
}

// POST { personaId, text, voiceId?, language? } -> raw 16-bit mono PCM; sample rate in X-Sample-Rate.
// The call's chosen Sarvam voice first, then the Fish clone (dad), then Gemini.
export async function tts(req: Request, log: CallLog): Promise<Response> {
  const { personaId, text, voiceId, language = 'hinglish' } =
    (await req.json()) as { personaId: string; text: string; voiceId?: string; language?: Language }
  if (!text || text.length > MAX_TTS_CHARS) return json({ error: 'bad text length' }, 400)
  const p = persona(personaId)
  const list = engines(p, text, language, voiceId)
  for (const [i, e] of list.entries()) {
    const last = i === list.length - 1
    const t0 = Date.now()
    const ctl = new AbortController()
    req.signal?.addEventListener('abort', () => ctl.abort())
    const timer = setTimeout(() => ctl.abort(), e.timeoutMs)
    let r: Response
    try {
      r = await fetch(e.url, {
        method: 'POST', headers: e.headers(), signal: ctl.signal, body: JSON.stringify(await e.body()),
      })
    } catch (err) {
      log.event({ kind: 'error', api: 'tts', engine: e.name, model: e.model, detail: String(err).slice(0, 200) })
      if (last || req.signal?.aborted) throw err
      continue
    } finally {
      clearTimeout(timer)
    }
    if (!r.ok || !r.body) {
      if (last) return upstreamError('tts', r, log)
      const detail = (await r.text()).slice(0, 300)
      console.error(`[api] tts ${e.name} HTTP ${r.status}: ${detail}`)
      log.event({ kind: 'error', api: 'tts', engine: e.name, model: e.model, status: r.status, detail })
      continue
    }
    const rate = e.rate ?? (Number(/rate=(\d+)/.exec(r.headers.get('Content-Type') || '')?.[1]) || PCM_RATE)
    const headersMs = Date.now() - t0
    const [toClient, toLog] = r.body.tee()
    const done = collect(toLog, t0)
    log.file(`${log.turn}_him_${Date.now()}.wav`, done.then((d) => pcmToWav(d.bytes, rate)))
    void done.then((d) => log.event({
      kind: 'tts', text, engine: e.name, model: e.model, voice: e.voice, fallback: i > 0, headersMs,
      firstByteMs: d.firstMs, totalMs: d.totalMs, bytes: d.bytes.length, seconds: +(d.bytes.length / 2 / rate).toFixed(2),
    }), () => undefined)
    return new Response(toClient, {
      headers: {
        'Content-Type': 'audio/pcm',
        'X-Sample-Rate': String(rate),
        'X-Upstream-Ms': String(headersMs),
        'X-Model': e.model,
        'X-Engine': e.name,
      },
    })
  }
  return json({ error: 'tts failed' }, 502)
}

// POST { kind: 'start' | 'end' | 'feedback', ... } from the client: session summaries and the
// optional thumbs up/down + note after the call, saved as JSON next to the call's audio.
export async function logSession(req: Request, log: CallLog): Promise<Response> {
  const raw = await req.text()
  if (raw.length > MAX_LOG_BYTES) return json({ error: 'too large' }, 413)
  const body = JSON.parse(raw) as { kind?: string }
  const kind = body.kind === 'start' || body.kind === 'feedback' ? body.kind : 'end'
  const record = {
    ...body, receivedAt: new Date().toISOString(), ip: clientIp(req),
    userAgent: req.headers.get('User-Agent'), models: { llm: LLM_MODEL, stt: STT_MODEL, tts: TTS_MODEL },
  }
  log.file(`${kind === 'end' ? 'session' : kind}.json`, new TextEncoder().encode(JSON.stringify(record, null, 2)),
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
