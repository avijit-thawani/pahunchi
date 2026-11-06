import { useEffect, useMemo } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Phone, PhoneOff } from 'lucide-react'
import { persona } from '../../shared/personas.ts'
import { parseIncoming } from '../../shared/scene.ts'
import { startCall } from '../lib/activeCall.ts'
import { rang } from '../lib/later.ts'
import { startRingtone } from '../lib/ringtone.ts'
import { useSettings } from '../lib/store.ts'

/** A scheduled call ringing: opened by the push notification or by the in-app timer. */
export default function IncomingPage() {
  const { search } = useLocation()
  const navigate = useNavigate()
  const [stored] = useSettings()
  const ring = useMemo(() => parseIncoming(search), [search])
  const id = new URLSearchParams(search).get('id')

  useEffect(() => {
    if (id) rang(id)
  }, [id])
  useEffect(() => startRingtone(), [])

  if (!ring) return <Navigate to="/" replace />
  const name = ring.name || persona(ring.personaId).defaultName

  const accept = () => {
    startCall({ ...stored, personaId: ring.personaId, name, language: ring.language }, ring.scene)
    navigate('/call', { replace: true })
  }

  return (
    <main className="call-bg fixed inset-0 text-white flex flex-col items-center px-6 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(3rem,env(safe-area-inset-bottom))]">
      <p className="text-white/60 mt-8">Incoming call</p>
      <div className="w-24 h-24 rounded-full bg-gradient-to-br from-sky-600 to-indigo-800 grid place-items-center text-4xl font-light mt-6">
        {name.slice(0, 1).toUpperCase()}
      </div>
      <h1 className="text-3xl font-light mt-5">{name}</h1>
      <p className="text-white/60 mt-1">mobile</p>

      <div className="flex-1" />

      <div className="w-full max-w-xs flex justify-between mb-6">
        <button onClick={() => navigate('/', { replace: true })} className="flex flex-col items-center gap-2" aria-label="Decline">
          <span className="w-[72px] h-[72px] rounded-full bg-red-600 grid place-items-center active:scale-95">
            <PhoneOff size={30} />
          </span>
          <span className="text-sm text-white/80">Decline</span>
        </button>
        <button onClick={accept} className="flex flex-col items-center gap-2" aria-label="Accept">
          <span className="w-[72px] h-[72px] rounded-full bg-green-600 grid place-items-center active:scale-95 animate-pulse">
            <Phone size={30} />
          </span>
          <span className="text-sm text-white/80">Accept</span>
        </button>
      </div>
    </main>
  )
}
