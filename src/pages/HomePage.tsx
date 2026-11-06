import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Moon, Phone, Sun } from 'lucide-react'
import { DEFAULT_PERSONA, LANGUAGES, PERSONAS, persona } from '../../shared/personas.ts'
import { useSettings } from '../lib/store.ts'
import { startCall } from '../lib/activeCall.ts'
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme.ts'

const EMOJI: Record<string, string> = {
  dad: '👨🏽‍🦳', mom: '👩🏽', brother: '🧑🏽', sister: '👩🏽‍🦱', friend_m: '🙋🏽‍♂️', friend_f: '🙋🏽‍♀️',
}
const NEXT_THEME: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' }
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon }

function ThemeButton() {
  const [pref, setPref] = useState(getThemePref)
  const Icon = THEME_ICON[pref]
  const next = () => {
    const p = NEXT_THEME[pref]
    setThemePref(p)
    setPref(p)
  }
  return (
    <button onClick={next} className="btn btn-ghost btn-circle" aria-label={`Theme: ${pref}`} title={`Theme: ${pref}`}>
      <Icon className="w-5 h-5" />
    </button>
  )
}

export default function HomePage() {
  const [stored, setSettings] = useSettings()
  const navigate = useNavigate()
  const settings = persona(stored.personaId).available
    ? stored
    : { ...stored, personaId: DEFAULT_PERSONA, name: persona(DEFAULT_PERSONA).defaultName }
  const callee = settings.name.trim() || persona(settings.personaId).defaultName

  const call = () => {
    startCall({ ...settings, name: callee })
    navigate('/call')
  }

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">phoney</h1>
          <p className="text-base-content/70 text-sm font-semibold">
            Walking alone or in a cab? Call someone who actually talks back.
          </p>
        </div>
        <ThemeButton />
      </header>

      <section>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60 mb-2">Who picks up</h2>
        <div className="grid grid-cols-3 gap-2">
          {PERSONAS.map((p) => (
            <button
              key={p.id}
              disabled={!p.available}
              data-selected={settings.personaId === p.id}
              onClick={() => setSettings({ ...settings, personaId: p.id, name: p.defaultName })}
              className="pick relative flex flex-col items-center gap-1 py-3 px-1"
            >
              <span className="text-3xl leading-none">{EMOJI[p.id] ?? '🙂'}</span>
              <span className="font-extrabold text-sm">{p.available ? p.defaultName : p.label}</span>
              {!p.available && (
                <span className="badge badge-xs badge-ghost font-bold absolute -top-2 whitespace-nowrap">Coming soon</span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60 mb-2">Language</h2>
        <div className="grid grid-cols-3 gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              data-selected={settings.language === l.id}
              onClick={() => setSettings({ ...settings, language: l.id })}
              className="pick py-2.5 font-extrabold text-sm"
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-base-200 rounded-box p-4 space-y-4">
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
      </section>

      <button onClick={call} className="btn btn-success btn-chunky btn-lg w-full h-16 rounded-2xl text-lg font-extrabold gap-3">
        <Phone className="w-6 h-6" /> Call {callee}
      </button>
      <p className="text-center text-xs text-base-content/50 font-semibold -mt-3">Free · beta: calls are recorded to improve the voice</p>
    </main>
  )
}
