// A call she scheduled ("Call me later"): the responder rings her, with a purpose she picked.

import type { Language } from './personas.ts'

export type Purpose = 'escape' | 'checkin'

export type Scene = {
  purpose: Purpose
  /** EXCUSES id; escape only. */
  excuse?: string
}

/** Who rings and why; travels in the push payload and the /incoming URL. */
export type Ring = { personaId: string; name: string; language: Language; scene: Scene }

export function incomingUrl(r: Ring, id = ''): string {
  const q = new URLSearchParams({ id, p: r.personaId, n: r.name, l: r.language, s: r.scene.purpose })
  if (r.scene.excuse) q.set('x', r.scene.excuse)
  return `/incoming?${q}`
}

export function parseIncoming(search: string): Ring | null {
  const q = new URLSearchParams(search)
  const p = q.get('p')
  const l = q.get('l') as Language | null
  const s = q.get('s') as Purpose | null
  if (!p || !l || (s !== 'escape' && s !== 'checkin')) return null
  return { personaId: p, name: q.get('n') || '', language: l, scene: { purpose: s, excuse: q.get('x') || undefined } }
}

export const PURPOSES: { id: Purpose; label: string; hint: string }[] = [
  { id: 'escape', label: 'Get me out', hint: 'He calls with a reason you have to leave now' },
  { id: 'checkin', label: 'Check on me', hint: '"Pahunch gayi? Sab theek?"' },
]

/** `label` is shown to her; `prompt` tells the responder what the story is. */
export const EXCUSES: { id: string; label: string; prompt: string }[] = [
  {
    id: 'unwell',
    label: 'Someone at home is unwell',
    prompt: 'an elderly family member at home (dadi or nani) is not feeling well and is asking for her, so she should come home now',
  },
  {
    id: 'keys',
    label: 'Locked out, she has the keys',
    prompt: 'you are locked out of the house and she has the only spare key, so you need her to come now',
  },
  {
    id: 'cab',
    label: 'Cab is waiting for her',
    prompt: 'you already booked a cab for her and it is arriving where she is in about five minutes',
  },
  {
    id: 'improvise',
    label: 'Let him improvise',
    prompt: 'pick one believable, mild family reason she must leave now (nothing scary, nothing medical-emergency)',
  },
]

export const DELAYS_MIN = [5, 15, 30, 60]

export const excuse = (id?: string) => EXCUSES.find((e) => e.id === id) ?? EXCUSES[EXCUSES.length - 1]
