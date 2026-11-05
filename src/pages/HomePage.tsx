import { useNavigate } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { LANGUAGES, PERSONAS, persona } from '../../shared/personas.ts'
import { useSettings } from '../lib/store.ts'
import { startCall } from '../lib/activeCall.ts'

export default function HomePage() {
  const [settings, setSettings] = useSettings()
  const navigate = useNavigate()

  const pick = (id: string) => {
    const wasDefault = PERSONAS.some((p) => p.defaultName === settings.name)
    setSettings({ ...settings, personaId: id, name: wasDefault || !settings.name ? persona(id).defaultName : settings.name })
  }

  const call = () => {
    startCall(settings)
    navigate('/call')
  }

  return (
    <main className="max-w-md mx-auto p-5 pb-28 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">phoney</h1>
        <p className="opacity-70 text-sm">A pretend call that talks back. Pick who picks up.</p>
      </header>

      <section className="grid grid-cols-3 gap-2">
        {PERSONAS.map((p) => (
          <button
            key={p.id}
            onClick={() => pick(p.id)}
            className={`btn h-auto py-3 flex-col gap-1 ${settings.personaId === p.id ? 'btn-primary' : 'btn-ghost bg-base-200'}`}
          >
            <span className="text-base">{p.label}</span>
            {!p.tested && <span className="text-[10px] opacity-60 font-normal">voice untested</span>}
          </button>
        ))}
      </section>

      <label className="form-control w-full block">
        <span className="label-text text-sm opacity-70">Name on the call screen</span>
        <input
          className="input input-bordered w-full mt-1"
          value={settings.name}
          onChange={(e) => setSettings({ ...settings, name: e.target.value })}
        />
      </label>

      <div>
        <span className="text-sm opacity-70">Language</span>
        <div className="join w-full mt-1">
          {LANGUAGES.map((l) => (
            <button
              key={l.id}
              onClick={() => setSettings({ ...settings, language: l.id })}
              className={`btn join-item flex-1 ${settings.language === l.id ? 'btn-primary' : ''}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center justify-between">
        <span className="text-sm">Background noise at their end (TV, fan)</span>
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={settings.ambience}
          onChange={(e) => setSettings({ ...settings, ambience: e.target.checked })}
        />
      </label>

      <button onClick={call} className="btn btn-success btn-lg w-full rounded-full gap-2">
        <Phone size={22} /> Call {settings.name || persona(settings.personaId).defaultName}
      </button>
    </main>
  )
}
