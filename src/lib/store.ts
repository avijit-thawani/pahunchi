// Local-only persistence (localStorage). Moves to Supabase once auth + sync exist.

import { useCallback, useState } from 'react'
import type { Turn } from '../../shared/api.ts'
import type { Language } from '../../shared/personas.ts'

export type Settings = {
  personaId: string
  name: string
  language: Language
  ambience: boolean
}

/** ttsMs = total minus the other stages; ttsFirstByteMs = reply received -> first TTS bytes. */
export type TurnMetrics = {
  turn?: string; speechMs?: number; vadMs?: number; sttMs?: number; llmMs?: number
  ttsFirstByteMs?: number; ttsMs?: number; totalMs?: number
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
}

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
}

export function getSession(id: string): Session | undefined {
  return read<Session[]>(KEYS.sessions, []).find((s) => s.id === id)
}

export function markSafe(id: string) {
  const s = getSession(id)
  if (s) saveSession({ ...s, safeAt: Date.now() })
}
