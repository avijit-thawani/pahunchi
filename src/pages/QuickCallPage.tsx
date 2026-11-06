import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone } from 'lucide-react'
import { persona } from '../../shared/personas.ts'
import { getSettings } from '../lib/store.ts'
import { startCall } from '../lib/activeCall.ts'
import { launchDone } from '../lib/install.ts'

/** Browsers start audio without a tap only for some installed apps; iPhone never does. */
function audioAllowed() {
  try {
    const ctx = new AudioContext()
    const ok = ctx.state === 'running'
    void ctx.close()
    return ok
  } catch {
    return false
  }
}

/** Home-screen icon / "Call now" shortcut: call straight away, or after one tap anywhere if the browser needs it. */
export default function QuickCallPage() {
  const navigate = useNavigate()
  const settings = getSettings()
  const name = settings.name.trim() || persona(settings.personaId).defaultName
  const started = useRef(false)

  const call = () => {
    if (started.current) return
    started.current = true
    startCall({ ...settings, name })
    navigate('/call', { replace: true })
  }

  useEffect(() => {
    launchDone()
    if (audioAllowed()) call()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <button
      onClick={call}
      className="call-bg fixed inset-0 text-white flex flex-col items-center justify-center gap-6 px-6"
      aria-label={`Call ${name}`}
    >
      <span className="w-28 h-28 rounded-full bg-green-600 grid place-items-center animate-pulse">
        <Phone size={44} />
      </span>
      <span className="text-3xl font-light">Call {name}</span>
      <span className="text-white/60">Tap anywhere</span>
    </button>
  )
}
