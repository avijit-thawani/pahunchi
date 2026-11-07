import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, PhoneIncoming, X } from 'lucide-react'
import { DELAYS_MIN, PURPOSES, incomingUrl, type Purpose, type Ring } from '../../shared/scene.ts'
import { cancelCall, pushSupport, scheduleCall, usePending } from '../lib/later.ts'

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function inMinutes(at: number) {
  const m = Math.round((at - Date.now()) / 60_000)
  return m <= 0 ? 'now' : m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)} h ${m % 60} min`
}

/** "<time>" today, or tomorrow if that time has passed. */
function atClock(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  if (d.getTime() <= Date.now() + 30_000) d.setDate(d.getDate() + 1)
  return d.getTime()
}

const NOTICE = {
  'ios-install': 'On iPhone, add Pahunchi to your Home Screen (Share → Add to Home Screen) so it can ring while closed. Until then it only rings if Pahunchi is open.',
  denied: 'Notifications are blocked for Pahunchi, so it only rings while Pahunchi is open.',
  none: 'This browser only rings while Pahunchi is open.',
  ok: '',
}

/** Cards for scheduled calls, at the top of the home screen. */
export function PendingCalls() {
  const pending = usePending()
  const navigate = useNavigate()
  if (!pending.length) return null
  return (
    <section className="space-y-2">
      {pending.map((p) => (
        <div key={p.id} className="bg-base-200 rounded-box p-3 flex items-center gap-3">
          <Clock className="w-5 h-5 shrink-0 text-secondary" />
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-sm">{p.ring.name} calls at {clock(p.at)}</p>
            <p className="text-xs font-semibold text-base-content/60">
              {inMinutes(p.at)} · {PURPOSES.find((x) => x.id === p.ring.scene.purpose)?.label}
            </p>
          </div>
          <button onClick={() => navigate(incomingUrl(p.ring, p.id))} className="btn btn-sm btn-ghost font-bold">Now</button>
          <button onClick={() => cancelCall(p.id)} className="btn btn-sm btn-ghost btn-circle" aria-label="Cancel scheduled call">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </section>
  )
}

/** Opens under the Call row: when, and a two-way "get me out / check on me" toggle. Mount only while open. */
export function LaterPanel({ ring, excuse, onDone, preset }: {
  ring: Omit<Ring, 'scene'>
  excuse?: string
  onDone: () => void
  preset?: { purpose: Purpose; delay: number }
}) {
  const [delay, setDelay] = useState<number | 'clock'>(preset?.delay ?? 15)
  const [time, setTime] = useState('')
  const [purpose, setPurpose] = useState<Purpose>(preset?.purpose ?? 'escape')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const notice = NOTICE[pushSupport()]

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const at = delay === 'clock' ? (time ? atClock(time) : 0) : now + delay * 60_000
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const scene = purpose === 'escape' ? { purpose, excuse } : { purpose }
      await scheduleCall({ ...ring, scene }, delay === 'clock' ? atClock(time) : Date.now() + delay * 60_000)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-base-200 rounded-box p-3 space-y-3 -mt-3">
      <div className="grid grid-cols-5 gap-2">
        {DELAYS_MIN.map((m) => (
          <button key={m} data-selected={delay === m} onClick={() => setDelay(m)} className="pick py-2 text-sm font-extrabold">
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </button>
        ))}
        <button data-selected={delay === 'clock'} onClick={() => setDelay('clock')} className="pick py-2 text-sm font-extrabold">At…</button>
      </div>
      {delay === 'clock' && (
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input w-full font-semibold" />
      )}
      <div className="grid grid-cols-2 gap-2">
        {PURPOSES.map((p) => (
          <button key={p.id} data-selected={purpose === p.id} onClick={() => setPurpose(p.id)} className="pick py-2 text-sm font-extrabold">
            {p.label}
          </button>
        ))}
      </div>
      {notice && <p className="text-xs font-semibold text-warning">{notice}</p>}
      {error && <p className="text-xs font-semibold text-error">{error}</p>}
      <button onClick={submit} disabled={busy || !at} className="btn btn-success btn-chunky w-full font-extrabold gap-2">
        <PhoneIncoming className="w-5 h-5" /> {at ? `Ring me at ${clock(at)}` : 'Pick a time'}
      </button>
    </section>
  )
}
