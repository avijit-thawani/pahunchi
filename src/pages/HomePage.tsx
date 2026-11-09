import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Clock, MicOff, Monitor, Moon, Pause, Phone, Play, Sun } from 'lucide-react'
import { LaterPanel, PendingCalls } from './CallLater.tsx'
import InstallCard from './InstallCard.tsx'
import { HowTo, Step } from './HowTo.tsx'
import { EXCUSES, excuse, type Purpose } from '../../shared/scene.ts'
import { DEFAULT_PERSONA, LANGUAGES, PERSONAS, persona, type Language } from '../../shared/personas.ts'
import { useSessions, useSettings } from '../lib/store.ts'
import { startCall } from '../lib/activeCall.ts'
import { isNative } from '../lib/native.ts'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme.ts'

const EMOJI: Record<string, string> = {
  dad: '👨🏽‍🦳', mom: '👩🏽', brother: '🧑🏽', sister: '👩🏽‍🦱', friend_m: '🙋🏽‍♂️', friend_f: '🙋🏽‍♀️',
}
const THEMES: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: 'system', label: 'Auto', Icon: Monitor },
  { id: 'light', label: 'Light', Icon: Sun },
  { id: 'dark', label: 'Dark', Icon: Moon },
]

function ThemePicker() {
  const [pref, setPref] = useState(getThemePref)
  return (
    <div>
      <span className="text-sm font-bold text-base-content/70">Theme</span>
      <div className="grid grid-cols-3 gap-2 mt-1">
        {THEMES.map(({ id, label, Icon }) => (
          <button
            key={id}
            data-selected={pref === id}
            onClick={() => {
              setThemePref(id)
              setPref(id)
            }}
            className="pick py-2.5 font-extrabold text-sm flex items-center justify-center gap-1.5"
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 'denied' once she has blocked the mic; browsers without the Permissions API report 'unknown'. */
function useMicPermission() {
  const [state, setState] = useState<PermissionState | 'unknown'>('unknown')
  useEffect(() => {
    let status: PermissionStatus | undefined
    const update = () => status && setState(status.state)
    navigator.permissions?.query({ name: 'microphone' as PermissionName })
      .then((s) => {
        status = s
        update()
        s.addEventListener('change', update)
      })
      .catch(() => undefined)
    return () => status?.removeEventListener('change', update)
  }, [])
  return state
}

function useSample(src: string) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = () => {
    if (!audio.current) {
      audio.current = new Audio(src)
      audio.current.onended = () => setPlaying(false)
    }
    if (playing) audio.current.pause()
    else void audio.current.play()
    setPlaying(!playing)
  }
  return [playing, toggle] as const
}

function SampleButton() {
  const [playing, toggle] = useSample('/demos/audio/cab_night.mp3')
  return (
    <button onClick={toggle} className="inline-flex items-center gap-1 font-bold text-secondary">
      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} Hear a sample
    </button>
  )
}

type Later = { purpose: Purpose; delay: number } | null

const actionCls = 'btn btn-xs btn-ghost text-secondary font-extrabold gap-1 px-0 mt-1'

/** Folds once she has made a call and said something on it. */
function HomeHowTo({ name, onLater }: { name: string; onLater: (l: Later) => void }) {
  const [sessions] = useSessions()
  const [playing, toggle] = useSample('/demos/audio/walk_home.mp3')
  const talked = sessions.some((s) => s.turns.some((t) => t.who === 'her'))
  return (
    <HowTo tab="home" done={talked} title="How to use Pahunchi">
      <Step
        icon="🚶🏽‍♀️"
        title="Walking alone or in a cab"
        action={<button onClick={toggle} className={actionCls}>{playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} Hear one</button>}
      >
        Tap Call. {name} picks up and chats with you until you get there. People nearby hear a real call.
      </Step>
      <Step
        icon="🍷"
        title="Stuck on a bad date"
        action={<button onClick={() => onLater({ purpose: 'escape', delay: 5 })} className={actionCls}><Clock className="w-3.5 h-3.5" /> Ring me in 5 min</button>}
      >
        {name} rings with a reason you have to leave.
      </Step>
      <Step
        icon="⏰"
        title="Check on me"
        action={<button onClick={() => onLater({ purpose: 'checkin', delay: 30 })} className={actionCls}><Clock className="w-3.5 h-3.5" /> Ring me later</button>}
      >
        {name} rings at a time you pick to ask if you got there.
      </Step>
      <Step
        icon="🛡️"
        title="Someone to watch out"
        action={<Link to="/settings" className={actionCls}>Add a trusted contact</Link>}
      >
        A friend sees your calls right away, or only if you don't tap "I'm safe".
      </Step>
    </HowTo>
  )
}

export default function HomePage() {
  const [stored, setSettings] = useSettings()
  const navigate = useNavigate()
  const settings = persona(stored.personaId).available
    ? stored
    : { ...stored, personaId: DEFAULT_PERSONA, name: persona(DEFAULT_PERSONA).defaultName }
  const callee = settings.name.trim() || persona(settings.personaId).defaultName
  const she = persona(settings.personaId).gender === 'f'
  const [later, setLater] = useState<Later>(null)
  const laterRef = useRef<HTMLDivElement>(null)
  const mic = useMicPermission()
  const [sessions] = useSessions()
  useEffect(() => {
    if (later) laterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [later])

  const call = () => {
    startCall({ ...settings, name: callee })
    navigate('/call')
  }

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-6">
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">Pahunchi</h1>
        <p className="text-base-content/70 text-sm font-semibold">
          A call that talks back, for walking home, bad dates, or a check-in.
        </p>
      </header>

      <PendingCalls />
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/70">Who picks up</h2>
          <select
            aria-label="Language"
            className="select select-sm select-ghost font-extrabold text-secondary w-auto pr-8"
            value={settings.language}
            onChange={(e) => setSettings({ ...settings, language: e.target.value as Language })}
          >
            {LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2 overflow-x-auto snap-x -mx-5 px-5 pb-1 [scrollbar-width:none]">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              disabled={!p.available}
              data-selected={settings.personaId === p.id}
              onClick={() => setSettings({ ...settings, personaId: p.id, name: p.defaultName })}
              className="pick snap-start shrink-0 w-[4.75rem] flex flex-col items-center gap-1 py-2.5"
            >
              <span className="text-3xl leading-none">{EMOJI[p.id] ?? '🙂'}</span>
              <span className="font-extrabold text-sm">{p.defaultName}</span>
              <span className="text-[11px] font-semibold text-base-content/70 leading-none">{p.label.replace(/ \(.*\)/, '')}</span>
            </button>
          ))}
        </div>
      </section>

      <details className="collapse collapse-arrow bg-base-200 rounded-box">
        <summary className="collapse-title text-sm font-extrabold uppercase tracking-wide text-base-content/60 min-h-0 py-3">
          More options
        </summary>
        <div className="collapse-content space-y-4">
          <label className="block">
            <span className="text-sm font-bold text-base-content/70">Name on the call screen</span>
            <input
              className="input w-full mt-1 font-semibold"
              value={settings.name}
              placeholder={persona(settings.personaId).defaultName}
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold">Background noise at their end <span className="font-semibold text-base-content/60">(TV, fan)</span></span>
            <input
              type="checkbox"
              className="toggle toggle-success shrink-0"
              checked={settings.ambience}
              onChange={(e) => setSettings({ ...settings, ambience: e.target.checked })}
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold text-base-content/70">When {she ? 'she' : 'he'} calls to get you out, {she ? 'her' : 'his'} reason</span>
            <select
              className="select w-full mt-1 font-semibold"
              value={excuse(settings.excuse).id}
              onChange={(e) => setSettings({ ...settings, excuse: e.target.value })}
            >
              {EXCUSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
          <ThemePicker />
        </div>
      </details>

      {mic === 'denied' && (
        <p role="alert" className="flex items-center gap-2 rounded-box bg-error/15 text-error px-4 py-3 text-sm font-bold">
          <MicOff className="w-4 h-4 shrink-0" /> Mic is blocked, so {callee} can't hear you. Allow it in your browser's site settings.
        </p>
      )}

      <div className="flex gap-2">
        <button onClick={call} className="btn btn-success btn-chunky btn-lg flex-1 h-16 rounded-2xl text-lg font-extrabold gap-3">
          <Phone className="w-6 h-6" /> Call
        </button>
        <button
          onClick={() => setLater(later ? null : { purpose: 'escape', delay: 15 })}
          data-selected={!!later}
          className="pick w-16 h-16 rounded-2xl flex flex-col items-center justify-center gap-0.5"
          aria-label="Call me later"
          aria-expanded={!!later}
          title="Call me later"
        >
          <Clock className="w-6 h-6" />
          <span className="text-[11px] font-extrabold leading-none">Later</span>
        </button>
      </div>
      {later && (
        <div ref={laterRef} className="scroll-mb-24">
          <LaterPanel
            key={`${later.purpose}-${later.delay}`}
            preset={later}
            onDone={() => setLater(null)}
            excuse={settings.excuse}
            ring={{ personaId: settings.personaId, name: callee, language: settings.language }}
          />
        </div>
      )}
      {mic === 'prompt' && (
        <p className="text-center text-sm text-base-content/70 font-semibold -mt-3">{isNative ? 'Pahunchi' : 'Your browser'} will ask for the mic so {callee} can hear you.</p>
      )}
      <HomeHowTo name={callee} onLater={setLater} />
      <p className="flex justify-center items-center gap-2 text-xs text-base-content/70 font-semibold">
        <SampleButton />
        <span aria-hidden>·</span>
        <span>Calls are recorded</span>
        <span aria-hidden>·</span>
        <Link to="/privacy" className="link font-bold">Privacy</Link>
      </p>
      {sessions.length > 0 && <InstallCard name={callee} />}
    </main>
  )
}
