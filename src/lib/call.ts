// The call loop: ring -> responder picks up -> listen -> transcribe -> reply -> speak, plus
// occasional check-ins after long silences. UI subscribes via onChange.

import type { Turn } from '../../shared/api.ts'
import { SILENT } from '../../shared/api.ts'
import { persona, pickVoice } from '../../shared/personas.ts'
import type { Scene } from '../../shared/scene.ts'
import * as api from './api.ts'
import { CallAudio } from './audio.ts'
import { END_MS, Mic, PAUSE_MS } from './mic.ts'
import { saveSession, type CallEvent, type Session, type Settings, type TurnMetrics } from './store.ts'
import { syncCall } from './sync.ts'

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
const fillerCache = new Map<string, { bytes: Uint8Array; rate: number }[]>()
const RINGS = 2
const FILLER_AT_MS = 2500 // after her last word, if he hasn't started talking

const silenceGap = () => 35000 + Math.random() * 40000

/**
 * A turn started speculatively at the mic's short pause: transcribed and answered while we wait
 * to see whether she keeps talking. `hold` resolves true when the turn is confirmed (play it),
 * false when she resumed (drop it).
 */
type Speculation = {
  hold: Promise<boolean>
  release: (go: boolean) => void
  ctl: AbortController
  withdrawn: boolean
  turn?: string
}

type Prepared = { my: number; stream: api.ReplyStream; ctl: AbortController; startedAt: number }

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
  private current?: AbortController
  private spec?: Speculation
  private lastActivity = Date.now()
  private nextSilence = silenceGap()
  private turnsSinceFiller = 2
  private turnNo = 0
  private events: CallEvent[] = []
  private timer?: ReturnType<typeof setInterval>
  private wakeLock?: WakeLockSentinel

  /** Set for a scheduled call: he rings her, so no ringback and he speaks first. */
  private scene?: Scene

  constructor(settings: Settings, scene?: Scene) {
    this.settings = settings
    this.scene = scene
    this.session = {
      id: newSessionId(), startedAt: Date.now(), personaId: settings.personaId, name: settings.name,
      language: settings.language, turns: [], metrics: [], voiceId: pickVoice(persona(settings.personaId))?.id,
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
    syncCall({ ...this.session, turns: this.state.turns }, 3000)
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
    api.setSession(this.session.id, this.session.voiceId, this.settings.language)
    syncCall(this.session)
    api.logSession('start', {
      startedAt: new Date(this.session.startedAt).toISOString(), personaId: this.settings.personaId,
      voiceId: this.session.voiceId,
      name: this.settings.name, language: this.settings.language, ambience: this.settings.ambience, scene: this.scene,
      screen: `${screen.width}x${screen.height}`, standalone: matchMedia('(display-mode: standalone)').matches,
    })
    this.audio = new CallAudio()
    await this.audio.resume()
    this.set({ phase: 'ringing' })
    this.wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined)

    this.mic = new Mic(this.audio.ctx, {
      onSpeechStart: () => this.state.activity === 'listening' && this.set({ activity: 'hearing' }),
      onPause: (wav, speechMs) => this.speculate(wav, speechMs),
      onResume: () => this.withdraw(),
      onUtterance: (wav, speechMs) => this.endOfTurn(wav, speechMs),
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

    const connected: Omit<Turn, 'at'> = { who: 'event', text: this.scene ? 'she answered' : 'call connected' }
    const opening = this.prepare('00', connected)
    this.push(connected)
    if (!this.scene) await this.audio.ringback(RINGS)
    if (this.state.phase !== 'ringing') return
    this.set({ phase: 'connected', connectedAt: Date.now() })
    if (this.settings.ambience) void this.audio.startAmbience('/ambience/tv.mp3').catch(() => undefined)
    this.timer = setInterval(() => this.tick(), 1000)
    try {
      await this.speakPrepared(opening, { turn: '00' }, Date.now())
    } catch (e) {
      this.fail(e, '00')
      this.mic!.paused = false
    }
  }

  private async loadFillers() {
    const key = `${this.settings.personaId}:${this.settings.language}`
    if (fillerCache.has(key)) return
    const texts = FILLERS[this.settings.language] ?? FILLERS.hinglish
    const clips: { bytes: Uint8Array; rate: number }[] = []
    await Promise.all(texts.map(async (t) => {
      try {
        const res = await api.speech(this.settings.personaId, t, 'filler')
        const rate = Number(res.headers.get('X-Sample-Rate')) || 24000
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length > rate * 0.2) clips.push({ bytes, rate })
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
    const clip = clips[Math.floor(Math.random() * clips.length)]
    this.audio.play(this.audio.pcmToBuffer(clip.bytes, clip.rate))
  }

  /** She paused briefly: start transcribing and replying, but hold playback until confirmed. */
  private speculate(wav: Blob, speechMs: number) {
    if (this.state.phase !== 'connected') return
    this.withdraw()
    let release!: (go: boolean) => void
    const hold = new Promise<boolean>((r) => (release = r))
    const spec: Speculation = { hold, release, ctl: new AbortController(), withdrawn: false }
    this.spec = spec
    void this.heard(wav, speechMs, PAUSE_MS, spec)
  }

  /** She kept talking: drop the speculative turn (its requests are aborted, nothing was played). */
  private withdraw() {
    const s = this.spec
    if (!s) return
    this.spec = undefined
    s.withdrawn = true
    s.release(false)
    s.ctl.abort()
    this.gen++
    this.logEvent('speculation-withdrawn', undefined, s.turn)
    if (this.state.activity === 'thinking') this.set({ activity: 'hearing' })
  }

  private endOfTurn(wav: Blob, speechMs: number) {
    const s = this.spec
    if (s) {
      this.spec = undefined
      s.release(true)
      return
    }
    void this.heard(wav, speechMs, END_MS)
  }

  private async heard(wav: Blob, speechMs: number, tailMs: number, spec?: Speculation) {
    if (this.state.phase !== 'connected') return
    const t0 = Date.now() - tailMs
    const turn = this.nextTurn()
    if (spec) spec.turn = turn
    else this.set({ activity: 'thinking' })
    try {
      const r = await api.transcribe(wav, turn, this.settings.language, spec?.ctl.signal)
      if (spec?.withdrawn) return
      const text = r.text.trim()
      if (!text || /^[\s.,!?।]*$/.test(text)) {
        this.logEvent('empty-transcript', r.text, turn)
        if (this.state.activity === 'thinking' || this.state.activity === 'hearing') this.set({ activity: 'listening' })
        return
      }
      await this.respond({ turn, speechMs, vadMs: tailMs, sttMs: r.ms, speculative: !!spec }, t0, { who: 'her', text }, spec)
    } catch (e) {
      if (!spec?.withdrawn) this.fail(e, turn)
    }
  }

  /** Start streaming a reply (TTS starts per clause as it arrives); nothing plays yet. */
  private prepare(turn: string, next: Omit<Turn, 'at'>, ctl = new AbortController()): Prepared {
    const my = ++this.gen
    this.current?.abort()
    this.current = ctl
    const turns = [...this.state.turns, { ...next, at: Date.now() }]
    const stream = new api.ReplyStream({
      personaId: this.settings.personaId, name: this.settings.name, language: this.settings.language, turns,
      scene: this.scene,
    }, turn, ctl.signal)
    return { my, stream, ctl, startedAt: Date.now() }
  }

  private async respond(metrics: TurnMetrics, t0: number, next: Omit<Turn, 'at'>, spec?: Speculation) {
    const p = this.prepare(metrics.turn ?? 'xx', next, spec?.ctl)
    if (spec && !(await spec.hold)) return
    if (p.my !== this.gen || this.state.phase !== 'connected') return
    this.push(next)
    if (next.who === 'her') {
      this.lastActivity = Date.now()
      this.turnsSinceFiller++
    }
    this.set({ activity: 'thinking' })
    const filler = setTimeout(() => this.maybeFiller(p.my), Math.max(0, t0 + FILLER_AT_MS - Date.now()))
    try {
      await this.speakPrepared(p, metrics, t0, filler)
    } catch (e) {
      clearTimeout(filler)
      if (p.ctl.signal.aborted || p.my !== this.gen) return
      this.fail(e, metrics.turn)
      if (this.mic) this.mic.paused = false
    }
  }

  private async speakPrepared(p: Prepared, metrics: TurnMetrics, t0: number, filler?: ReturnType<typeof setTimeout>) {
    if (p.my !== this.gen || this.state.phase !== 'connected' || !this.audio) return
    const s = p.stream
    for (let i = 0; ; i++) {
      const res = await s.clip(i)
      if (p.my !== this.gen || this.state.phase !== 'connected') return
      if (!res) break
      if (i === 0) {
        metrics.llmMs = s.firstClauseMs
        metrics.ttsFirstByteMs = Date.now() - p.startedAt - (s.firstClauseMs ?? 0)
        metrics.ttsEngine = res.headers.get('X-Engine') ?? undefined
        clearTimeout(filler)
        this.mic!.paused = true
        this.set({ activity: 'speaking' })
      }
      await this.audio.playPcmStream(res, () => {
        if (i === 0) {
          metrics.totalMs = Date.now() - t0
          metrics.ttsMs = metrics.totalMs - (metrics.sttMs ?? 0) - (metrics.llmMs ?? 0) - (metrics.vadMs ?? 0)
        }
      })
    }
    await s.done
    if (p.my !== this.gen || this.state.phase !== 'connected') return
    clearTimeout(filler)
    metrics.replyMs = s.llmMs
    this.push({ who: 'them', text: s.text || SILENT })
    if (this.audio.speaking) await this.audio.drained()
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
    this.spec?.ctl.abort()
    this.current?.abort()
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
