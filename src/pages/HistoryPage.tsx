import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useSessions } from '../lib/store.ts'
import { SILENT } from '../../shared/api.ts'

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : undefined
}

export default function HistoryPage() {
  const [sessions] = useSessions()

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-3">
      <h1 className="text-3xl font-extrabold tracking-tight">History</h1>
      {!sessions.length && (
        <div className="bg-base-200 rounded-box p-6 text-center text-base-content/60 font-semibold">
          No calls yet. Your calls and transcripts show up here.
        </div>
      )}
      {sessions.map((s) => {
        const mins = Math.max(1, Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60000))
        const lat = median(s.metrics.map((m) => m.totalMs).filter((x): x is number => !!x))
        return (
          <details key={s.id} className="collapse collapse-arrow bg-base-200 border-2 border-base-300 rounded-box">
            <summary className="collapse-title">
              <div className="flex items-center gap-2">
                {s.safeAt ? <ShieldCheck className="w-5 h-5 text-success" /> : <ShieldAlert className="w-5 h-5 text-warning" />}
                <span className="font-extrabold">{s.name}</span>
                <span className="badge badge-sm badge-ghost font-bold capitalize">{s.language}</span>
              </div>
              <div className="text-base-content/60 text-xs font-semibold mt-1">
                {new Date(s.startedAt).toLocaleString()} · {mins} min
                {lat && ` · replies in ~${(lat / 1000).toFixed(1)}s`}
              </div>
            </summary>
            <div className="collapse-content text-sm space-y-1.5">
              {s.turns
                .filter((t) => !(t.who === 'them' && t.text === SILENT))
                .map((t, i) => (
                  <p key={i} className={t.who === 'event' ? 'text-base-content/40 italic text-xs' : t.who === 'her' ? 'text-secondary font-semibold' : ''}>
                    {t.who === 'event' ? `[${t.text}]` : <><b>{t.who === 'her' ? 'You' : s.name}:</b> {t.text}</>}
                  </p>
                ))}
            </div>
          </details>
        )
      })}
    </main>
  )
}
