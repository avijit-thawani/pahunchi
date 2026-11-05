import type { ReplyRequest, ReplyResponse, SttResponse } from '../../shared/api.ts'

// Every request carries the call's session id and turn label so the server can log the call.
let sessionId = ''
export function setSession(id: string) {
  sessionId = id
}

function hdrs(turn: string, type = 'application/json'): Record<string, string> {
  return { 'Content-Type': type, 'X-Phoney-Session': sessionId, 'X-Phoney-Turn': turn }
}

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw new Error(`${r.url.split('/api/')[1]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r
}

export async function transcribe(wav: Blob, turn: string): Promise<SttResponse> {
  const r = await ok(await fetch('/api/stt', { method: 'POST', headers: hdrs(turn, wav.type), body: wav }))
  return r.json()
}

export async function reply(req: ReplyRequest, turn: string): Promise<ReplyResponse> {
  const r = await ok(await fetch('/api/reply', { method: 'POST', headers: hdrs(turn), body: JSON.stringify(req) }))
  return r.json()
}

export async function speech(personaId: string, text: string, turn: string): Promise<Response> {
  return ok(await fetch('/api/tts', { method: 'POST', headers: hdrs(turn), body: JSON.stringify({ personaId, text }) }))
}

/** Session start/end summary for the server-side call log. Best effort, never throws. */
export function logSession(kind: 'start' | 'end', data: object) {
  const body = JSON.stringify({ kind, ...data })
  void fetch('/api/log', { method: 'POST', headers: hdrs(kind), body, keepalive: body.length < 60_000 })
    .catch(() => undefined)
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
