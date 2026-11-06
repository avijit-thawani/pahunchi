import type { ReplyChunk, ReplyRequest, SttResponse } from '../../shared/api.ts'
import { Clauses } from '../../shared/clauses.ts'

// Every request carries the call's session id and turn label so the server can log the call.
let sessionId = ''
let voice: { voiceId?: string; language?: string } = {}
export function setSession(id: string, voiceId?: string, language?: string) {
  sessionId = id
  voice = { voiceId, language }
}

function hdrs(turn: string, type = 'application/json'): Record<string, string> {
  return { 'Content-Type': type, 'X-Phoney-Session': sessionId, 'X-Phoney-Turn': turn }
}

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw new Error(`${r.url.split('/api/')[1]}: ${r.status} ${(await r.text()).slice(0, 200)}`)
  return r
}

export async function transcribe(wav: Blob, turn: string, language: string, signal?: AbortSignal): Promise<SttResponse> {
  const r = await ok(await fetch(`/api/stt?lang=${language}`, { method: 'POST', headers: hdrs(turn, wav.type), body: wav, signal }))
  return r.json()
}

export async function speech(personaId: string, text: string, turn: string, signal?: AbortSignal): Promise<Response> {
  return ok(await fetch('/api/tts', {
    method: 'POST', headers: hdrs(turn), body: JSON.stringify({ personaId, text, ...voice }), signal,
  }))
}

/**
 * A streamed reply. Each clause is sent to TTS as soon as it is complete, so the first one can
 * play while the rest are still being written. A SILENT reply yields no clips.
 */
export class ReplyStream {
  text = ''
  llmMs = 0
  /** Request start -> first clause sent to TTS. */
  firstClauseMs?: number
  readonly clips: Promise<Response>[] = []
  readonly done: Promise<void>
  private finished = false
  private error?: unknown
  private waiters: (() => void)[] = []

  constructor(req: ReplyRequest, turn: string, signal: AbortSignal) {
    this.done = this.run(req, turn, signal)
    this.done.catch(() => undefined)
  }

  private async run(req: ReplyRequest, turn: string, signal: AbortSignal) {
    const t0 = Date.now()
    const clauses = new Clauses()
    const add = (clause: string) => {
      this.firstClauseMs ??= Date.now() - t0
      const clip = speech(req.personaId, clause, turn, signal)
      clip.catch(() => undefined)
      this.clips.push(clip)
    }
    try {
      const r = await ok(await fetch('/api/reply', {
        method: 'POST', headers: hdrs(turn), body: JSON.stringify(req), signal,
      }))
      const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      let final = false
      for (;;) {
        const { done, value } = await reader.read()
        if (value) buf += value
        const lines = buf.split('\n')
        buf = done ? '' : lines.pop()!
        for (const line of lines.filter((l) => l.trim())) {
          const c = JSON.parse(line) as ReplyChunk
          if ('error' in c) throw new Error(`reply: ${c.error}`)
          if ('d' in c) clauses.push(c.d).forEach(add)
          else {
            final = true
            this.text = c.text
            this.llmMs = Date.now() - t0
          }
          this.wake()
        }
        if (done) break
      }
      if (!final) throw new Error('reply: stream ended early')
      clauses.flush().forEach(add)
    } catch (e) {
      this.error = e
      throw e
    } finally {
      this.finished = true
      this.wake()
    }
  }

  private wake() {
    this.waiters.splice(0).forEach((w) => w())
  }

  /** The i-th clip's audio response, waiting for its clause; null once the reply has no more. */
  async clip(i: number): Promise<Response | null> {
    for (;;) {
      if (i < this.clips.length) return this.clips[i]
      if (this.finished) {
        if (this.error) throw this.error
        return null
      }
      await new Promise<void>((r) => this.waiters.push(r))
    }
  }
}

/** Thumbs up/down (+ optional note) after a call, filed under that call's log. Best effort. */
export function sendFeedback(session: string, data: object) {
  void fetch('/api/log', {
    method: 'POST', body: JSON.stringify({ kind: 'feedback', ...data }),
    headers: { 'Content-Type': 'application/json', 'X-Phoney-Session': session, 'X-Phoney-Turn': 'feedback' },
  }).catch(() => undefined)
}

/** Session start/end summary for the server-side call log. Best effort, never throws. */
export function logSession(kind: 'start' | 'end' | 'feedback', data: object) {
  const body = JSON.stringify({ kind, ...data })
  void fetch('/api/log', { method: 'POST', headers: hdrs(kind), body, keepalive: body.length < 60_000 })
    .catch(() => undefined)
}
