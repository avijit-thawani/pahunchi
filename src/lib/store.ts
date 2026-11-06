// Local persistence (localStorage). While signed in, sessions are also mirrored to Supabase
// (sync.ts) and trusted contacts live there (ContactsPage); settings stay local.

import { useCallback, useState } from 'react'
import type { Turn } from '../../shared/api.ts'
import type { Language } from '../../shared/personas.ts'
import { syncCall } from './sync.ts'

export type Settings = {
  personaId: string
  name: string
  language: Language
  ambience: boolean
  /** EXCUSES id used when a scheduled "Get me out" call rings. */
  excuse?: string
  /** Opening phoney from the home screen goes straight to a call (/go). On unless set to false. */
  quickLaunch?: boolean
}

/**
 * totalMs = her last word -> his first sound. vadMs = silence before the pipeline started (the
 * speculative pause, or the full end-of-turn tail). llmMs = reply request -> first clause;
 * replyMs = the whole reply. ttsFirstByteMs = first clause -> first TTS bytes; ttsMs = total
 * minus the other stages (includes waiting for the turn to be confirmed).
 */
export type TurnMetrics = {
  turn?: string; speechMs?: number; vadMs?: number; sttMs?: number; llmMs?: number; replyMs?: number
  ttsFirstByteMs?: number; ttsMs?: number; totalMs?: number; speculative?: boolean; ttsEngine?: string
}

/** Things worth seeing when debugging a call: silences, fillers, errors. */
export type CallEvent = { at: number; kind: string; turn?: string; detail?: string }

export type Session = {
  id: string
  startedAt: number
  endedAt?: number
  personaId: string
  name: string
  language: Language
  turns: Turn[]
  metrics: TurnMetrics[]
  events?: CallEvent[]
  safeAt?: number
  /** Which of the persona's voices this call used (picked at random, for A/B). */
  voiceId?: string
  feedback?: Feedback
}

export type Feedback = { rating: 'up' | 'down'; note?: string; at: number }

export type Contact = {
  id: string
  name: string
  phone: string
  /** Minutes to wait for "I'm safe" before alerting; 0 = alert as soon as a call starts. */
  delayMin: number
}

const KEYS = { settings: 'phoney.settings', sessions: 'phoney.sessions', contacts: 'phoney.contacts' }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback))
  const set = useCallback((v: T) => {
    write(key, v)
    setValue(v)
  }, [key])
  return [value, set]
}

export const DEFAULT_SETTINGS: Settings = { personaId: 'dad', name: 'Papa', language: 'hinglish', ambience: true }

export const useSettings = () => useStored<Settings>(KEYS.settings, DEFAULT_SETTINGS)
export const useContacts = () => useStored<Contact[]>(KEYS.contacts, [])
export const useSessions = () => useStored<Session[]>(KEYS.sessions, [])

export function getSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(KEYS.settings, {}) }
}

export function saveSession(s: Session) {
  const all = read<Session[]>(KEYS.sessions, []).filter((x) => x.id !== s.id)
  write(KEYS.sessions, [s, ...all].slice(0, 200))
  syncCall(s)
}

export function getSession(id: string): Session | undefined {
  return read<Session[]>(KEYS.sessions, []).find((s) => s.id === id)
}

export function markSafe(id: string) {
  const s = getSession(id)
  if (s) saveSession({ ...s, safeAt: Date.now() })
}

export function setFeedback(id: string, rating: Feedback['rating'], note?: string): Feedback {
  const feedback: Feedback = { rating, note: note?.trim() || undefined, at: Date.now() }
  const s = getSession(id)
  if (s) saveSession({ ...s, feedback })
  return feedback
}
