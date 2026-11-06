import { lazy, Suspense, useEffect, useState } from 'react'
import { PhoneCall, ShieldAlert, ShieldCheck } from 'lucide-react'
import type { Turn } from '../../shared/api.ts'
import { SILENT } from '../../shared/api.ts'
import { supabase, useSession } from '../lib/supabase.ts'

const CallMap = lazy(() => import('./CallMap.tsx'))

type SharedCall = {
  owner_name: string
  id: string
  persona_name: string
  started_at: string
  ended_at: string | null
  safe_at: string | null
  turns: Turn[]
  delay_min: number
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** Calls from people who made me their trusted contact, as their delay rules allow. */
export default function SharedCalls() {
  const session = useSession()
  const [calls, setCalls] = useState<SharedCall[]>([])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string, on: boolean) => setOpen((o) => {
    const n = new Set(o)
    if (on) n.add(id)
    else n.delete(id)
    return n
  })

  useEffect(() => {
    if (!supabase || !session) return
    const load = () => supabase!.rpc('shared_calls').then(({ data }) => data && setCalls(data))
    load()
    // delays run out while the page is open, and live calls keep growing
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [session])

  if (!calls.length) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60">Shared with you</h2>
      {calls.map((c) => {
        const first = c.owner_name.split(' ')[0]
        const status = c.safe_at
          ? { Icon: ShieldCheck, cls: 'text-success', text: `Marked safe at ${time(c.safe_at)}` }
          : !c.ended_at
            ? { Icon: PhoneCall, cls: 'text-info', text: 'On a call now' }
            : { Icon: ShieldAlert, cls: 'text-warning', text: `Call ended ${time(c.ended_at)}, not marked safe` }
        return (
          <details key={c.id} onToggle={(e) => toggle(c.id, e.currentTarget.open)}
            className="collapse collapse-arrow bg-base-200 border-2 border-warning/50 rounded-box">
            <summary className="collapse-title">
              <div className="flex items-center gap-2">
                <status.Icon className={`w-5 h-5 ${status.cls}`} />
                <span className="font-extrabold">{c.owner_name}</span>
              </div>
              <div className="text-base-content/70 text-xs font-semibold mt-1">
                Started {new Date(c.started_at).toLocaleString()} · {status.text}
              </div>
              <div className="text-base-content/50 text-xs font-semibold">
                {c.delay_min ? `Shown because ${first} didn't tap "I'm safe" within ${c.delay_min} min` : 'Shared as soon as a call starts'}
              </div>
            </summary>
            <div className="collapse-content text-sm space-y-1.5">
              {open.has(c.id) && <Suspense><CallMap callId={c.id} live={!c.ended_at && !c.safe_at} /></Suspense>}
              {!c.turns.length && <p className="text-base-content/50 italic text-xs">No words yet.</p>}
              {c.turns
                .filter((t) => !(t.who === 'them' && t.text === SILENT))
                .map((t, i) => (
                  <p key={i} className={t.who === 'event' ? 'text-base-content/40 italic text-xs' : t.who === 'her' ? 'text-secondary font-semibold' : ''}>
                    {t.who === 'event' ? `[${t.text}]` : <><b>{t.who === 'her' ? first : `${c.persona_name} (AI)`}:</b> {t.text}</>}
                  </p>
                ))}
            </div>
          </details>
        )
      })}
    </section>
  )
}
