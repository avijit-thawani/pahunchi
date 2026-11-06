import { useEffect, useState, useSyncExternalStore } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Captions, Grid3x3, MicOff, Pause, PhoneOff, UserPlus, Volume2 } from 'lucide-react'
import { activeCall, clearCall } from '../lib/activeCall.ts'
import type { CallState } from '../lib/call.ts'
import { SILENT } from '../../shared/api.ts'

function useClock(from?: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  if (!from) return null
  const s = Math.max(0, Math.floor((now - from) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function RoundButton({ icon: Icon, label, active, onClick }: {
  icon: typeof MicOff; label: string; active?: boolean; onClick?: () => void
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 text-white/80">
      <span className={`w-16 h-16 rounded-full grid place-items-center ${active ? 'bg-white text-black' : 'bg-white/10'}`}>
        <Icon size={26} />
      </span>
      <span className="text-xs">{label}</span>
    </button>
  )
}

const noSubscribe = () => () => {}
const noState = () => undefined

export default function CallPage() {
  const [engine] = useState(activeCall)
  const navigate = useNavigate()
  const state: CallState | undefined = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getState ?? noState)
  const [showText, setShowText] = useState(false)
  const [, setTick] = useState(0)
  const clock = useClock(state?.connectedAt)

  useEffect(() => {
    if (!showText) return
    const t = setInterval(() => setTick((n) => n + 1), 120)
    return () => clearInterval(t)
  }, [showText])

  if (!engine || !state) return <Navigate to="/" replace />

  const end = () => {
    const session = engine.hangup()
    clearCall()
    navigate(`/after/${session.id}`, { replace: true })
  }

  const status = state.phase === 'ringing' ? 'Ringing…' : state.phase === 'connected' ? clock : 'Call ended'
  const name = engine.name
  const visible = state.turns.filter((t) => !(t.who === 'them' && t.text === SILENT))
  const last = state.metrics[state.metrics.length - 1]

  return (
    <main className="call-bg fixed inset-0 text-white flex flex-col items-center px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <button onClick={() => setShowText(!showText)} className="absolute top-4 right-4 opacity-30" aria-label="transcript">
        <Captions size={20} />
      </button>

      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-sky-600 to-indigo-800 grid place-items-center text-4xl font-light mt-8">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <h1 className="text-3xl font-light mt-5">{name}</h1>
      <p className="text-white/60 mt-1 tabular-nums">{status}</p>
      {state.muted && state.phase === 'connected' && (
        <button
          onClick={() => engine.toggleMute()}
          className="mt-3 flex items-center gap-2 rounded-full bg-red-500/20 text-red-200 px-4 py-1.5 text-sm font-semibold"
        >
          <MicOff className="w-4 h-4" /> Muted · {name} can't hear you
        </button>
      )}
      {state.error && <p className="text-error text-xs mt-2 text-center">{state.error}</p>}

      <div className="flex-1 w-full overflow-y-auto my-4">
        {showText && (
          <div className="text-sm space-y-1.5 bg-black/30 rounded-xl p-3">
            <div className="flex items-center gap-2 text-xs text-white/50">
              <span>{state.activity}</span>
              <progress className="progress w-24 h-1.5" value={Math.min(1, engine.level / (engine.threshold * 2 || 1))} max={1} />
              {last?.totalMs && (
                <span>
                  last reply {(last.totalMs / 1000).toFixed(1)}s (stt {last.sttMs}, llm {last.llmMs}, tts {last.ttsMs} ms)
                </span>
              )}
            </div>
            {visible.map((t, i) => (
              <p key={i} className={t.who === 'event' ? 'text-white/40 italic text-xs' : t.who === 'her' ? 'text-sky-300' : ''}>
                {t.who === 'event' ? `[${t.text}]` : t.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-x-10 gap-y-6 mb-10">
        <RoundButton icon={MicOff} label={state.muted ? 'Muted' : 'Mute'} active={state.muted} onClick={() => engine.toggleMute()} />
        <RoundButton icon={Grid3x3} label="Keypad" />
        <RoundButton icon={Volume2} label="Speaker" active={state.speaker} onClick={() => engine.toggleSpeaker()} />
        <RoundButton icon={UserPlus} label="Add call" />
        <RoundButton icon={Pause} label="Hold" />
        <RoundButton icon={Captions} label="Text" active={showText} onClick={() => setShowText(!showText)} />
      </div>

      <button onClick={end} className="w-[72px] h-[72px] rounded-full bg-red-600 grid place-items-center active:scale-95" aria-label="End call">
        <PhoneOff size={30} />
      </button>
    </main>
  )
}
