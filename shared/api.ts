import type { Language } from './personas.ts'
import type { Scene } from './scene.ts'

// One line of the call. `her` = the user, `them` = the AI responder, `event` = e.g. a long silence.
export type Turn = { who: 'her' | 'them' | 'event'; text: string; at: number }

export type ReplyRequest = {
  personaId: string
  name: string
  language: Language
  turns: Turn[]
  /** Set when he is calling her (a scheduled call), not she him. */
  scene?: Scene
}

export type ReplyResponse = { text: string; ms: number; model: string }
export type SttResponse = { text: string; ms: number; model: string }

// /api/reply streams newline-delimited JSON: text deltas, then one final line (or an error).
export type ReplyChunk = { d: string } | ({ done: true } & ReplyResponse) | { error: string }

// Sent by the responder to stay quiet; never spoken.
export const SILENT = '...'
