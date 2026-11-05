// The call loop: ring -> responder picks up -> listen -> transcribe -> reply -> speak, plus
// occasional check-ins after long silences. UI subscribes via onChange.

import type { Turn } from '../../shared/api.ts'
import { SILENT } from '../../shared/api.ts'
import * as api from './api.ts'
import { CallAudio } from './audio.ts'
import { Mic } from './mic.ts'
import { saveSession, type CallEvent, type Session, type Settings, type TurnMetrics } from './store.ts'

export type Phase = 'idle' | 'ringing' | 'connected' | 'ended'
export type Activity = 'listening' | 'hearing' | 'thinking' | 'speaking'

export type CallState = {
  phase: Phase
  activity: Activity
  connectedAt?: number
  turns: Turn[]
  metrics: TurnMetrics[]
  muted: boolean
  speaker: boolean
  error?: string
}

const FILLERS: Record<string, string[]> = {
  hinglish: ['हम्म।', 'हाँ।', 'अच्छा।'],
  hindi: ['हम्म।', 'हाँ।', 'अच्छा।'],
  english: ['Hmm.', 'Haan.', 'Okay.'],
}
const fillerCache = new Map<string, Uint8Array[]>()
const RINGS = 2
const FILLER_AFTER_MS = 1100
const VAD_TAIL_MS = 800

const silenceGap = () => 35000 + Math.random() * 40000

/** Sortable, log-folder-friendly id: 20261105-181300-k3x9qa (local time). */
function newSessionId() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`
}

export class CallEngine {
  state: CallState = { phase: 'idle', activity: 'listening', turns: [], metrics: [], muted: false, speaker: true }
  level = 0
  threshold = 0
  private listeners = new Set<() => void>()

  private settings: Settings
  private session: Session
  private audio?: CallAudio
  private mic?: Mic
  private gen = 0
  private lastActivity = Date.now()
  private nextSilence = silenceGap()
  private turnsSinceFiller = 2
  private turnNo = 0
  private events: CallEvent[] = []
  private timer?: ReturnType<typeof setInterval>
  private wakeLock?: WakeLockSentinel

  constructor(settings: Settings) {
    this.settings = settings
    this.session = {
      id: newSessionId(), startedAt: Date.now(), personaId: settings.personaId, name: settings.name,
      language: settings.language, turns: [], metrics: [],
    }
  }

  get name() {
    return this.settings.name
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  getState = () => this.state

  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private push(turn: Omit<Turn, 'at'>) {
    this.set({ turns: [...this.state.turns, { ...turn, at: Date.now() }] })
  }

  private nextTurn() {
    return String(++this.turnNo).padStart(2, '0')
  }

  private logEvent(kind: string, detail?: string, turn?: string) {
    this.events.push({ at: Date.now(), kind, turn, detail })
  }

  private fail(e: unknown, turn?: string) {
    this.logEvent('error', String(e), turn)
    this.set({ activity: 'listening', error: String(e) })
  }

  /** Call from the tap handler: audio and mic permissions need a user gesture. */
  async start() {
    api.setSession(this.session.id)
    api.logSession('start', {
      startedAt: new Date(this.session.startedAt).toISOString(), personaId: this.settings.personaId,
      name: this.settings.name, language: this.settings.language, ambience: this.settings.ambience,
      screen: `${screen.width}x${screen.height}`, standalone: matchMedia('(display-mode: standalone)').matches,
    })
    this.audio = new CallAudio()
    await this.audio.resume()
    this.set({ phase: 'ringing' })
    this.wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined)

    this.mic = new Mic(this.audio.ctx, {
      onSpeechStart: () => this.state.activity === 'listening' && this.set({ activity: 'hearing' }),
      onUtterance: (wav, speechMs) => void this.heard(wav, speechMs),
      onLevel: (rms, th) => {
        this.level = rms
        this.threshold = th
      },
    })
    this.mic.paused = true
    try {
      await this.mic.start()
    } catch (e) {
      this.logEvent('error', `mic: ${e}`)
      this.set({ error: 'Microphone permission is needed for the call.' })
    }
    void this.loadFillers()

    const opening = this.prepare('00', { who: 'event', text: 'call connected' })
    await this.audio.ringback(RINGS)
    if (this.state.phase !== 'ringing') return
    this.set({ phase: 'connected', connectedAt: Date.now() })
    if (this.settings.ambience) void this.audio.startAmbience('/ambience/tv.mp3').catch(() => undefined)
    this.timer = setInterval(() => this.tick(), 1000)
    try {
      await this.speakPrepared(await opening, { turn: '00' }, Date.now())
    } catch (e) {
      this.fail(e, '00')
      this.mic!.paused = false
    }
  }

  private async loadFillers() {
    const key = `${this.settings.personaId}:${this.settings.language}`
    if (fillerCache.has(key)) return
    const texts = FILLERS[this.settings.language] ?? FILLERS.hinglish
    const clips: Uint8Array[] = []
    await Promise.all(texts.map(async (t) => {
      try {
        const bytes = new Uint8Array(await (await api.speech(this.settings.personaId, t, 'filler')).arrayBuffer())
        if (bytes.length > 4800) clips.push(bytes)
      } catch {
        // a missing filler is fine
      }
    }))
    fillerCache.set(key, clips)
  }

  private maybeFiller(my: number) {
    const clips = fillerCache.get(`${this.settings.personaId}:${this.settings.language}`)
    if (my !== this.gen || !clips?.length || !this.audio || this.audio.speaking) return
    if (this.turnsSinceFiller < 2 || Math.random() > 0.7) return
    this.turnsSinceFiller = 0
    this.logEvent('filler')
    this.mic!.paused = true
    this.audio.play(this.audio.pcmToBuffer(clips[Math.floor(Math.random() * clips.length)]))
  }

  private async heard(wav: Blob, speechMs: number) {
    if (this.state.phase !== 'connected') return
    const t0 = Date.now() - VAD_TAIL_MS
    const turn = this.nextTurn()
    this.set({ activity: 'thinking' })
    try {
      const r = await api.transcribe(wav, turn)
      const text = r.text.trim()
      if (!text || /^[\s.,!?।]*$/.test(text)) {
        this.logEvent('empty-transcript', r.text, turn)
        if (this.state.activity === 'thinking') this.set({ activity: 'listening' })
        return
      }
      this.push({ who: 'her', text })
      this.lastActivity = Date.now()
      this.turnsSinceFiller++
      await this.respond({ turn, speechMs, vadMs: VAD_TAIL_MS, sttMs: r.ms }, t0)
    } catch (e) {
      this.fail(e, turn)
    }
  }

  /** Ask for a reply and start fetching its audio; nothing plays yet. */
  private async prepare(turn: string, event?: Omit<Turn, 'at'>) {
    const my = ++this.gen
    const turns = event ? [...this.state.turns, { ...event, at: Date.now() }] : this.state.turns
    if (event) this.push(event)
    const r = await api.reply({
      personaId: this.settings.personaId, name: this.settings.name, language: this.settings.language, turns,
    }, turn)
    const repliedAt = Date.now()
    const parts = r.text === SILENT ? [] : api.sentences(r.text)
    const audio = parts.map((p) => api.speech(this.settings.personaId, p, turn))
    audio.forEach((a) => a.catch(() => undefined))
    return { my, text: r.text, llmMs: r.ms, audio, repliedAt }
  }

  private async respond(metrics: TurnMetrics, t0: number, event?: Omit<Turn, 'at'>) {
    this.set({ activity: 'thinking' })
    const myNext = this.gen + 1
    const filler = setTimeout(() => this.maybeFiller(myNext), FILLER_AFTER_MS)
    try {
      const prepared = await this.prepare(metrics.turn ?? 'xx', event)
      await this.speakPrepared(prepared, metrics, t0, filler)
    } catch (e) {
      clearTimeout(filler)
      this.fail(e, metrics.turn)
      if (this.mic) this.mic.paused = false
    }
  }

  private async speakPrepared(
    p: Awaited<ReturnType<CallEngine['prepare']>>, metrics: TurnMetrics, t0: number,
    filler?: ReturnType<typeof setTimeout>,
  ) {
    if (p.my !== this.gen || this.state.phase !== 'connected' || !this.audio) return
    metrics.llmMs = p.llmMs
    this.push({ who: 'them', text: p.text })
    if (!p.audio.length) {
      clearTimeout(filler)
      if (this.audio.speaking) await this.audio.drained()
      this.finishTurn(p.my, metrics)
      return
    }
    this.mic!.paused = true
    for (let i = 0; i < p.audio.length; i++) {
      const res = await p.audio[i]
      if (p.my !== this.gen || this.state.phase !== 'connected') return
      if (i === 0) {
        metrics.ttsFirstByteMs = Date.now() - p.repliedAt
        clearTimeout(filler)
        this.set({ activity: 'speaking' })
      }
      await this.audio.playPcmStream(res, () => {
        if (i === 0) {
          metrics.totalMs = Date.now() - t0
          metrics.ttsMs = metrics.totalMs - (metrics.sttMs ?? 0) - (metrics.llmMs ?? 0) - VAD_TAIL_MS
        }
      })
    }
    await this.audio.drained()
    this.finishTurn(p.my, metrics)
  }

  private finishTurn(my: number, metrics: TurnMetrics) {
    if (my !== this.gen || this.state.phase !== 'connected') return
    this.set({ activity: 'listening', metrics: [...this.state.metrics, metrics] })
    this.lastActivity = Date.now()
    if (this.mic) this.mic.paused = false
  }

  private tick() {
    if (this.state.phase !== 'connected' || this.state.activity !== 'listening') return
    const quiet = Date.now() - this.lastActivity
    if (quiet < this.nextSilence) return
    this.lastActivity = Date.now()
    this.nextSilence = silenceGap()
    const turn = this.nextTurn()
    const text = `silence ${Math.round(quiet / 1000)}s`
    this.logEvent('silence', text, turn)
    void this.respond({ turn }, Date.now(), { who: 'event', text })
  }

  toggleMute() {
    const muted = !this.state.muted
    if (this.mic) this.mic.muted = muted
    this.set({ muted })
  }

  toggleSpeaker() {
    const speaker = !this.state.speaker
    this.audio?.setVolume(speaker ? 1 : 0.5)
    this.set({ speaker })
  }

  hangup(): Session {
    this.gen++
    clearInterval(this.timer)
    this.mic?.stop()
    this.audio?.close()
    void this.wakeLock?.release().catch(() => undefined)
    this.set({ phase: 'ended' })
    this.logEvent('hangup')
    this.session = {
      ...this.session, endedAt: Date.now(), turns: this.state.turns, metrics: this.state.metrics, events: this.events,
    }
    saveSession(this.session)
    api.logSession('end', {
      ...this.session, startedAt: new Date(this.session.startedAt).toISOString(),
      endedAt: new Date(this.session.endedAt!).toISOString(),
      durationS: Math.round((this.session.endedAt! - this.session.startedAt) / 1000),
    })
    return this.session
  }
}
