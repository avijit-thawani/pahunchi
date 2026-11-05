import type { ReplyRequest, ReplyResponse, SttResponse } from '../../shared/api.ts'

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw new Error(`${r.url.split('/api/')[1]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r
}

export async function transcribe(wav: Blob): Promise<SttResponse> {
  const r = await ok(await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': wav.type }, body: wav }))
  return r.json()
}

export async function reply(req: ReplyRequest, signal?: AbortSignal): Promise<ReplyResponse> {
  const r = await ok(await fetch('/api/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal,
  }))
  return r.json()
}

export async function speech(personaId: string, text: string, signal?: AbortSignal): Promise<Response> {
  return ok(await fetch('/api/tts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personaId, text }), signal,
  }))
}

/** Split a reply into sentences so the first one can be voiced while the rest are generated. */
export function sentences(text: string): string[] {
  const parts = text.match(/[^.!?।]+[.!?।]+["”']?|[^.!?।]+$/g) ?? [text]
  const out: string[] = []
  for (const p of parts.map((s) => s.trim()).filter(Boolean)) {
    if (out.length && out[out.length - 1].length < 12) out[out.length - 1] += ' ' + p
    else out.push(p)
  }
  return out
}
