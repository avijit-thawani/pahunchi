import { useState } from 'react'
import { Trash2, UserPlus } from 'lucide-react'
import { useContacts } from '../lib/store.ts'

const DELAYS = [
  { min: 0, label: 'As soon as a call starts' },
  { min: 30, label: 'If I don\'t tap "I\'m safe" within 30 min' },
  { min: 60, label: 'Within 1 hour' },
  { min: 180, label: 'Within 3 hours' },
]

export default function ContactsPage() {
  const [contacts, setContacts] = useContacts()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [delayMin, setDelayMin] = useState(30)

  const add = () => {
    if (!name.trim() || !phone.trim()) return
    setContacts([...contacts, { id: crypto.randomUUID(), name: name.trim(), phone: phone.trim(), delayMin }])
    setName('')
    setPhone('')
  }

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Trusted contacts</h1>
        <span className="badge badge-warning font-extrabold">Coming soon</span>
      </div>
      <p className="text-base-content/70 font-semibold">
        Only disturb your loved ones if needed: they get a gentle note ("a call was started, please check on her")
        with the call and transcript, right away or only if you don't tap <b>I'm safe</b> in time.
      </p>
      <div role="alert" className="rounded-box border-2 border-warning/60 bg-warning/15 px-4 py-3 text-sm font-semibold">
        Not active yet: contacts are saved on this phone only and nobody is notified.
      </div>

      {contacts.map((c) => (
        <div key={c.id} className="flex items-center gap-3 bg-base-200 border-2 border-base-300 rounded-box p-3">
          <div className="w-10 h-10 rounded-full bg-secondary/15 text-secondary grid place-items-center font-extrabold">
            {c.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold">{c.name}</div>
            <div className="text-xs text-base-content/60 font-semibold truncate">
              {c.phone} · {DELAYS.find((d) => d.min === c.delayMin)?.label}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm btn-circle" aria-label="Remove" onClick={() => setContacts(contacts.filter((x) => x.id !== c.id))}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      <section className="space-y-2 bg-base-200 rounded-box p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60">Add someone</h2>
        <input className="input w-full font-semibold" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-full font-semibold" placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select className="select w-full font-semibold" value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))}>
          {DELAYS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
        </select>
        <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold gap-2" onClick={add}>
          <UserPlus className="w-5 h-5" /> Add contact
        </button>
      </section>
    </main>
  )
}
