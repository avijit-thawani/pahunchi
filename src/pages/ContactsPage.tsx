import { useState } from 'react'
import { Trash2 } from 'lucide-react'
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
    <main className="max-w-md mx-auto p-5 pb-28 space-y-4">
      <h1 className="text-2xl font-bold">Trusted contacts</h1>
      <p className="text-sm opacity-70">
        They get a gentle note ("a call was started, please check on her") with the call and transcript,
        either right away or only if you don't confirm you're safe in time.
      </p>
      <div role="alert" className="alert alert-warning text-xs py-2">
        Saved on this device only. Sending alerts needs the backend (Supabase), not set up yet.
      </div>

      <div className="space-y-2">
        {contacts.map((c) => (
          <div key={c.id} className="flex items-center gap-3 bg-base-200 rounded-box p-3">
            <div className="flex-1">
              <div className="font-medium">{c.name}</div>
              <div className="text-xs opacity-60">{c.phone} · {DELAYS.find((d) => d.min === c.delayMin)?.label}</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setContacts(contacts.filter((x) => x.id !== c.id))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="space-y-2 bg-base-200 rounded-box p-3">
        <input className="input input-bordered w-full" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input input-bordered w-full" placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select className="select select-bordered w-full" value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))}>
          {DELAYS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
        </select>
        <button className="btn btn-primary w-full" onClick={add}>Add contact</button>
      </div>
    </main>
  )
}
