// API handlers in web-standard Request -> Response form, so they can move to Netlify
// Functions later unchanged. In dev, vite.config.ts mounts them at /api/<name>.

import { persona } from '../shared/personas.ts'
import type { ReplyRequest, ReplyResponse, SttResponse } from '../shared/api.ts'
import { SILENT } from '../shared/api.ts'
import { systemPrompt } from './prompt.ts'

const BASE = 'https://openrouter.ai/api/v1'
const LLM_MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'
const STT_MODEL = process.env.PHONEY_STT_MODEL || 'openai/gpt-4o-mini-transcribe'
const TTS_MODEL = process.env.PHONEY_TTS_MODEL || 'google/gemini-3.8-flash-tts'
const MAX_TTS_CHARS = 400
const MAX_AUDIO_BYTES = 5_000_000

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new Error('OPENROUTER_API_KEY is not set')
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'phoney' }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function upstreamError(label: string, r: Response): Promise<Response> {
  const text = (await r.text()).slice(0, 300)
  console.error(`[api] ${label} HTTP ${r.status}: ${text}`)
  return json({ error: `${label} failed (${r.status})` }, 502)
}

// POST raw audio bytes (Content-Type audio/wav, audio/webm, ...) -> { text }
export async function stt(req: Request): Promise<Response> {
  const buf = new Uint8Array(await req.arrayBuffer())
  if (!buf.length || buf.length > MAX_AUDIO_BYTES) return json({ error: 'bad audio size' }, 400)
  const format = (req.headers.get('Content-Type') || 'audio/wav').split('/')[1].split(';')[0]
  const t0 = Date.now()
  const r = await fetch(`${BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model: STT_MODEL,
      input_audio: { data: Buffer.from(buf).toString('base64'), format },
    }),
  })
  if (!r.ok) return upstreamError('stt', r)
  const data = await r.json()
  const out: SttResponse = { text: (data.text || '').trim(), ms: Date.now() - t0, model: STT_MODEL }
  return json(out)
}

// POST ReplyRequest -> { text } (text === SILENT means stay quiet)
export async function reply(req: Request): Promise<Response> {
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
  if (!r.ok) return upstreamError('reply', r)
  const data = await r.json()
  let text: string = (data.choices?.[0]?.message?.content || '').trim()
  text = text.replace(/^["“]|["”]$/g, '').trim()
  if (!text || /^[.…\s]+$/.test(text)) text = SILENT
  const out: ReplyResponse = { text, ms: Date.now() - t0, model: LLM_MODEL }
  return json(out)
}

// POST { personaId, text } -> raw 24 kHz 16-bit mono PCM
export async function tts(req: Request): Promise<Response> {
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
  if (!r.ok || !r.body) return upstreamError('tts', r)
  return new Response(r.body, {
    headers: {
      'Content-Type': 'audio/pcm',
      'X-Sample-Rate': '24000',
      'X-Upstream-Ms': String(Date.now() - t0),
      'X-Model': TTS_MODEL,
    },
  })
}

export const handlers: Record<string, (req: Request) => Promise<Response>> = { stt, reply, tts }
