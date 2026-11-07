import { useEffect, useState, type ReactNode } from 'react'

const key = (tab: string) => `phoney.howto.${tab}`

/** A tab's how-to: open until she reaches the tab's milestone (`done`), then folded for good, still one tap away. */
export function HowTo({ tab, done, title, children }: { tab: string; done: boolean; title: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !done && localStorage.getItem(key(tab)) !== '1')
  const [wasDone, setWasDone] = useState(done)
  if (done !== wasDone) {
    setWasDone(done)
    if (done) setOpen(false)
  }
  useEffect(() => {
    if (done) localStorage.setItem(key(tab), '1')
  }, [tab, done])
  return (
    <details
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="collapse collapse-arrow bg-secondary/10 rounded-box"
    >
      <summary className="collapse-title text-sm font-extrabold min-h-0 py-3">{title}</summary>
      <ul className="collapse-content space-y-3 text-sm">{children}</ul>
    </details>
  )
}

export function Step({ icon, title, children, action }: { icon: string; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="text-xl leading-6 shrink-0" aria-hidden>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="font-extrabold">{title}</p>
        <p className="font-semibold text-base-content/70">{children}</p>
        {action}
      </div>
    </li>
  )
}
