import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, PhoneIncoming, X } from 'lucide-react'
import { DELAYS_MIN, EXCUSES, PURPOSES, incomingUrl, type Purpose, type Ring } from '../../shared/scene.ts'
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
  'ios-install': 'On iPhone, add phoney to your Home Screen (Share → Add to Home Screen) and open it from there so the call can ring while phoney is closed. Until then it only rings if phoney is open.',
  denied: 'Notifications are blocked for phoney, so it can only ring while phoney is open. Allow them in your browser settings.',
  none: "This browser can't ring in the background. Keep phoney open and it will ring on time.",
  ok: "You'll get a notification at that time; tap it to answer. The first time, allow notifications.",
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

/** Bottom sheet: when, why, and (for "Get me out") which excuse. Mount only while open. */
export function CallLaterSheet({ ring, onClose }: { ring: Omit<Ring, 'scene'>; onClose: () => void }) {
  const [delay, setDelay] = useState<number | 'clock'>(15)
  const [time, setTime] = useState('')
  const [purpose, setPurpose] = useState<Purpose>('escape')
  const [excuseId, setExcuseId] = useState(EXCUSES[0].id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const support = pushSupport()

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const at = delay === 'clock' ? (time ? atClock(time) : 0) : now + delay * 60_000
  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const scene = purpose === 'escape' ? { purpose, excuse: excuseId } : { purpose }
      await scheduleCall({ ...ring, scene }, delay === 'clock' ? atClock(time) : Date.now() + delay * 60_000)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal modal-bottom sm:modal-middle modal-open">
      <div className="modal-box max-w-md space-y-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h3 className="text-xl font-extrabold">{ring.name} calls you</h3>

        <section>
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60 mb-2">When</h4>
          <div className="grid grid-cols-5 gap-2">
            {DELAYS_MIN.map((m) => (
              <button key={m} data-selected={delay === m} onClick={() => setDelay(m)} className="pick py-2 text-sm font-extrabold">
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
            <button data-selected={delay === 'clock'} onClick={() => setDelay('clock')} className="pick py-2 text-sm font-extrabold">At…</button>
          </div>
          {delay === 'clock' && (
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="input w-full mt-2 font-semibold" />
          )}
        </section>

        <section>
          <h4 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60 mb-2">Why</h4>
          <div className="grid grid-cols-2 gap-2">
            {PURPOSES.map((p) => (
              <button key={p.id} data-selected={purpose === p.id} onClick={() => setPurpose(p.id)} className="pick p-3 text-left">
                <span className="block font-extrabold text-sm">{p.label}</span>
                <span className="block text-xs font-semibold text-base-content/60 mt-0.5">{p.hint}</span>
              </button>
            ))}
          </div>
          {purpose === 'escape' && (
            <div className="grid grid-cols-1 gap-1.5 mt-2">
              {EXCUSES.map((x) => (
                <button key={x.id} data-selected={excuseId === x.id} onClick={() => setExcuseId(x.id)} className="pick py-2 px-3 text-left text-sm font-bold">
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </section>

        <p className={`text-xs font-semibold ${support === 'ok' ? 'text-base-content/60' : 'text-warning'}`}>{NOTICE[support]}</p>
        {error && <p className="text-xs font-semibold text-error">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} className="btn btn-ghost flex-1 font-bold">Cancel</button>
          <button onClick={submit} disabled={busy || !at} className="btn btn-success btn-chunky flex-[2] font-extrabold gap-2">
            <PhoneIncoming className="w-5 h-5" /> {at ? `Ring me at ${clock(at)}` : 'Pick a time'}
          </button>
        </div>
      </div>
      <button className="modal-backdrop" onClick={onClose} aria-label="Close" />
    </div>
  )
}
