import { useState } from 'react'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { HowTo, Step } from './HowTo.tsx'
import { useSessions } from '../lib/store.ts'
import { SILENT } from '../../shared/api.ts'
import SharedCalls from './SharedCalls.tsx'

export default function HistoryPage() {
  const [sessions, setSessions] = useSessions()
  const [opened, setOpened] = useState(false)
  const clear = () => {
    if (confirm('Delete all call history on this phone?')) setSessions([])
  }

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-extrabold tracking-tight">History</h1>
        {sessions.length > 0 && (
          <button onClick={clear} className="btn btn-ghost btn-sm gap-1 font-bold text-base-content/70">
            <Trash2 className="w-4 h-4" /> Clear
          </button>
        )}
      </div>
      <HowTo tab="history" done={opened} title="How History works">
        <Step icon="📝" title="Read a call">Tap a call to see what you both said.</Step>
        <Step icon="🛡️" title="Marked safe">A green shield means you tapped "I'm safe" after that call.</Step>
        <Step icon="🗑️" title="Clear">Deletes the list on this phone. To delete everything, use Settings.</Step>
      </HowTo>
      <SharedCalls />
      {!sessions.length && (
        <div className="bg-base-200 rounded-box p-6 text-center text-base-content/60 font-semibold">
          No calls yet. Your calls and transcripts show up here.
        </div>
      )}
      {sessions.map((s) => {
        const mins = Math.max(1, Math.round(((s.endedAt ?? s.startedAt) - s.startedAt) / 60000))
        return (
          <details key={s.id} onToggle={(e) => e.currentTarget.open && setOpened(true)} className="collapse collapse-arrow bg-base-200 border-2 border-base-300 rounded-box">
            <summary className="collapse-title">
              <div className="flex items-center gap-2">
                <span className="font-extrabold">{s.name}</span>
                {s.safeAt && <ShieldCheck className="w-4 h-4 text-success" aria-label="Marked safe" />}
              </div>
              <div className="text-base-content/70 text-xs font-semibold mt-1">
                {new Date(s.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {mins} min
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
