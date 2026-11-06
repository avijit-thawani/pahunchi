// Demo-only call for screenshots and the README video: `/call?demo=ringing`, `/call?demo=connected`,
// or `/call?demo=script`, which replays localStorage['phoney.demoScript'] ({ ringMs, turns: [{ who,
// text, atMs }] }, times from pick-up) so a screen recording lines up with recorded call audio.
// No mic, audio or network; a scripted Hinglish cab call.

import type { Turn } from '../../shared/api.ts'
import type { CallState } from './call.ts'
import type { Session } from './store.ts'

const SCRIPT: [Turn['who'], string][] = [
  ['her', 'Hello Papa? Haan, main cab mein baith gayi hoon.'],
  ['them', 'Achha beta. Kaun si gaadi hai? Number bata zara.'],
  ['her', 'White Dzire hai. DL 3C AB 4521.'],
  ['them', 'Hmm, likh liya. Location bhi aa gayi.'],
]

/** startAt: epoch ms when ringing starts (default: page load), so a recorder can align to it. */
type DemoScript = { startAt?: number; ringMs: number; turns: { who: Turn['who']; text: string; atMs: number }[] }

export function demoCall(mode: string) {
  const now = Date.now()
  const connected = mode !== 'ringing'
  let state: CallState = {
    phase: connected ? 'connected' : 'ringing',
    activity: 'listening',
    connectedAt: connected ? now - 83_000 : undefined,
    turns: connected ? SCRIPT.map(([who, text], i) => ({ who, text, at: now - 80_000 + i * 6000 })) : [],
    metrics: connected ? [{ sttMs: 562, llmMs: 645, ttsMs: 816, totalMs: 2323 }] : [],
    muted: false,
    speaker: true,
  }
  const listeners = new Set<() => void>()
  const script: DemoScript | null = mode === 'script' ? JSON.parse(localStorage.getItem('phoney.demoScript') || 'null') : null
  if (script) {
    const pickup = (script.startAt ?? now) + script.ringMs
    state = { ...state, phase: 'ringing', connectedAt: undefined, turns: [], metrics: [] }
    const timer = setInterval(() => {
      const t = Date.now() - pickup
      if (t < 0) return
      const turns = script.turns.filter((x) => x.atMs <= t).map((x) => ({ who: x.who, text: x.text, at: pickup + x.atMs }))
      if (state.phase === 'connected' && turns.length === state.turns.length) return
      state = { ...state, phase: 'connected', connectedAt: pickup, turns }
      listeners.forEach((l) => l())
      if (turns.length === script.turns.length) clearInterval(timer)
    }, 50)
  }
  return {
    name: 'Papa',
    level: 0.004,
    threshold: 0.01,
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    getState: () => state,
    toggleMute() {},
    toggleSpeaker() {},
    hangup: (): Session => ({ id: 'demo', startedAt: now - 83_000, endedAt: now, personaId: 'dad', name: 'Papa', language: 'hinglish', turns: state.turns, metrics: state.metrics }),
  }
}
