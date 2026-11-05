import type { Language } from './personas.ts'

// One line of the call. `her` = the user, `them` = the AI responder, `event` = e.g. a long silence.
export type Turn = { who: 'her' | 'them' | 'event'; text: string; at: number }

export type ReplyRequest = {
  personaId: string
  name: string
  language: Language
  turns: Turn[]
}

export type ReplyResponse = { text: string; ms: number; model: string }
export type SttResponse = { text: string; ms: number; model: string }

// Sent by the responder to stay quiet; never spoken.
export const SILENT = '...'
