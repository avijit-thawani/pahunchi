// The call loop: ring -> responder picks up -> listen -> transcribe -> reply -> speak, plus
// occasional check-ins after long silences. UI subscribes via onChange.

import type { Turn } from '../../shared/api.ts'
import { SILENT } from '../../shared/api.ts'
import * as api from './api.ts'
import { CallAudio } from './audio.ts'
import { Mic } from './mic.ts'
import { saveSession, type Session, type Settings, type TurnMetrics } from './store.ts'

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
  private timer?: ReturnType<typeof setInterval>
  private wakeLock?: WakeLockSentinel

  constructor(settings: Settings) {
    this.settings = settings
    this.session = {
      id: crypto.randomUUID(), startedAt: Date.now(), personaId: settings.personaId, name: settings.name,
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

  /** Call from the tap handler: audio and mic permissions need a user gesture. */
  async start() {
    this.audio = new CallAudio()
    await this.audio.resume()
    this.set({ phase: 'ringing' })
    this.wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined)

    this.mic = new Mic(this.audio.ctx, {
      onSpeechStart: () => this.state.activity === 'listening' && this.set({ activity: 'hearing' }),
      onUtterance: (wav) => void this.heard(wav),
      onLevel: (rms, th) => {
        this.level = rms
        this.threshold = th
      },
    })
    this.mic.paused = true
    try {
      await this.mic.start()
    } catch {
      this.set({ error: 'Microphone permission is needed for the call.' })
    }
    void this.loadFillers()

    const opening = this.prepare({ who: 'event', text: 'call connected' })
    await this.audio.ringback(RINGS)
    if (this.state.phase !== 'ringing') return
    this.set({ phase: 'connected', connectedAt: Date.now() })
    if (this.settings.ambience) void this.audio.startAmbience('/ambience/tv.mp3').catch(() => undefined)
    this.timer = setInterval(() => this.tick(), 1000)
    try {
      await this.speakPrepared(await opening, {}, Date.now())
    } catch (e) {
      this.set({ activity: 'listening', error: String(e) })
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
        const bytes = new Uint8Array(await (await api.speech(this.settings.personaId, t)).arrayBuffer())
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
    this.mic!.paused = true
    this.audio.play(this.audio.pcmToBuffer(clips[Math.floor(Math.random() * clips.length)]))
  }

  private async heard(wav: Blob) {
    if (this.state.phase !== 'connected') return
    const t0 = Date.now() - VAD_TAIL_MS
    this.set({ activity: 'thinking' })
    try {
      const r = await api.transcribe(wav)
      const text = r.text.trim()
      if (!text || /^[\s.,!?।]*$/.test(text)) {
        if (this.state.activity === 'thinking') this.set({ activity: 'listening' })
        return
      }
      this.push({ who: 'her', text })
      this.lastActivity = Date.now()
      this.turnsSinceFiller++
      await this.respond({ sttMs: r.ms }, t0)
    } catch (e) {
      this.set({ activity: 'listening', error: String(e) })
    }
  }

  /** Ask for a reply and start fetching its audio; nothing plays yet. */
  private async prepare(event?: Omit<Turn, 'at'>) {
    const my = ++this.gen
    const turns = event ? [...this.state.turns, { ...event, at: Date.now() }] : this.state.turns
    if (event) this.push(event)
    const r = await api.reply({
      personaId: this.settings.personaId, name: this.settings.name, language: this.settings.language, turns,
    })
    const parts = r.text === SILENT ? [] : api.sentences(r.text)
    const audio = parts.map((p) => api.speech(this.settings.personaId, p))
    audio.forEach((a) => a.catch(() => undefined))
    return { my, text: r.text, llmMs: r.ms, audio }
  }

  private async respond(metrics: TurnMetrics, t0: number, event?: Omit<Turn, 'at'>) {
    this.set({ activity: 'thinking' })
    const myNext = this.gen + 1
    const filler = setTimeout(() => this.maybeFiller(myNext), FILLER_AFTER_MS)
    try {
      const prepared = await this.prepare(event)
      await this.speakPrepared(prepared, metrics, t0, filler)
    } catch (e) {
      clearTimeout(filler)
      this.set({ activity: 'listening', error: String(e) })
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
    void this.respond({}, Date.now(), { who: 'event', text: `silence ${Math.round(quiet / 1000)}s` })
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
    this.session = { ...this.session, endedAt: Date.now(), turns: this.state.turns, metrics: this.state.metrics }
    saveSession(this.session)
    return this.session
  }
}
