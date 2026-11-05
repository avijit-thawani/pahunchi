import { ShieldCheck, ShieldAlert } from 'lucide-react'
import { useSessions } from '../lib/store.ts'
import { persona } from '../../shared/personas.ts'
import { SILENT } from '../../shared/api.ts'

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : undefined
}

export default function HistoryPage() {
  const [sessions] = useSessions()

  return (
    <main className="max-w-md mx-auto p-5 pb-28 space-y-3">
      <h1 className="text-2xl font-bold">History</h1>
      {!sessions.length && <p className="opacity-60 text-sm">No calls yet.</p>}
      {sessions.map((s) => {
        const mins = Math.max(1, Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60000))
        const lat = median(s.metrics.map((m) => m.totalMs).filter((x): x is number => !!x))
        return (
          <details key={s.id} className="collapse collapse-arrow bg-base-200">
            <summary className="collapse-title text-sm">
              <div className="flex items-center gap-2">
                {s.safeAt ? <ShieldCheck size={16} className="text-success" /> : <ShieldAlert size={16} className="text-warning" />}
                <span className="font-medium">{s.name}</span>
                <span className="opacity-60">({persona(s.personaId).label}, {s.language})</span>
              </div>
              <div className="opacity-60 text-xs mt-0.5">
                {new Date(s.startedAt).toLocaleString()} · {mins} min
                {lat && ` · median reply ${(lat / 1000).toFixed(1)}s`}
              </div>
            </summary>
            <div className="collapse-content text-sm space-y-1">
              {s.turns
                .filter((t) => !(t.who === 'them' && t.text === SILENT))
                .map((t, i) => (
                  <p key={i} className={t.who === 'event' ? 'opacity-40 italic text-xs' : t.who === 'her' ? 'text-info' : ''}>
                    {t.who === 'event' ? `[${t.text}]` : `${t.who === 'her' ? 'You' : s.name}: ${t.text}`}
                  </p>
                ))}
            </div>
          </details>
        )
      })}
    </main>
  )
}
