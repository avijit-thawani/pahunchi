import { useCallback, useEffect, useState } from 'react'
import { LogOut, Send, Trash2, UserPlus } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { useContacts } from '../lib/store.ts'
import { signInWithGoogle, signOut, supabase, userName, useSession } from '../lib/supabase.ts'

const DELAYS = [
  { min: 0, label: 'As soon as a call starts' },
  { min: 30, label: 'If I don\'t tap "I\'m safe" within 30 min' },
  { min: 60, label: 'Within 1 hour' },
  { min: 180, label: 'Within 3 hours' },
]

let movingLocal = false

type Row = {
  id: string
  name: string
  phone: string | null
  email: string | null
  delay_min: number
  invite_token: string
  joined_at: string | null
}

export default function ContactsPage() {
  const session = useSession()
  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Trusted contacts</h1>
        <span className="badge badge-warning font-extrabold">Beta</span>
      </div>
      <p className="text-base-content/70 font-semibold">
        People who should hear if something seems wrong: as soon as a call starts, or only if you don't
        tap <b>I'm safe</b> in time.
      </p>
      {!supabase ? (
        <Notice>Accounts aren't configured on this build.</Notice>
      ) : session === undefined ? (
        <div className="flex justify-center py-8"><span className="loading loading-dots" /></div>
      ) : session ? (
        <SignedIn session={session} />
      ) : (
        <SignedOut />
      )}
    </main>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="rounded-box border-2 border-warning/60 bg-warning/15 px-4 py-3 text-sm font-semibold">
      {children}
    </div>
  )
}

function SignedOut() {
  const [local] = useContacts()
  return (
    <section className="space-y-3 bg-base-200 rounded-box p-4">
      <p className="font-semibold">
        Alerts have to come from our server, so it needs to know who you are. Calls still work without an account.
      </p>
      {local.length > 0 && (
        <p className="text-sm text-base-content/70 font-semibold">
          The {local.length} contact{local.length > 1 ? 's' : ''} saved on this phone will move to your account.
        </p>
      )}
      <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold" onClick={() => signInWithGoogle()}>
        Sign in with Google
      </button>
    </section>
  )
}

function SignedIn({ session }: { session: Session }) {
  const db = supabase!
  const [rows, setRows] = useState<Row[] | null>(null)
  const [people, setPeople] = useState<{ link_id: string; owner_name: string; added_back: boolean }[]>([])
  const [error, setError] = useState('')
  const [local, setLocal] = useContacts()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [delayMin, setDelayMin] = useState(30)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const [c, p] = await Promise.all([
      db.from('trusted_contacts').select('id,name,phone,email,delay_min,invite_token,joined_at').order('created_at'),
      db.rpc('my_people'),
    ])
    if (c.error) setError(c.error.message)
    else setRows(c.data)
    if (p.data) setPeople(p.data)
  }, [db])

  useEffect(() => {
    // Contacts added before signing in lived only in localStorage; move them to the account once.
    if (movingLocal) return
    movingLocal = true
    ;(async () => {
      if (local.length) {
        const { error } = await db.from('trusted_contacts')
          .insert(local.map((c) => ({ name: c.name, phone: c.phone || null, delay_min: c.delayMin })))
        if (!error) setLocal([])
      }
      await load()
      movingLocal = false
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const add = async () => {
    if (!name.trim()) return
    const { error } = await db.from('trusted_contacts').insert({
      name: name.trim(), phone: phone.trim() || null, email: email.trim().toLowerCase() || null, delay_min: delayMin,
    })
    if (error) return setError(error.message)
    setError('')
    setName('')
    setPhone('')
    setEmail('')
    load()
  }

  const remove = async (id: string) => {
    const { error } = await db.from('trusted_contacts').delete().eq('id', id)
    if (error) setError(error.message)
    else load()
  }

  const setDelay = async (id: string, delay_min: number) => {
    setRows((rs) => rs && rs.map((r) => (r.id === id ? { ...r, delay_min } : r)))
    const { error } = await db.from('trusted_contacts').update({ delay_min }).eq('id', id)
    if (error) {
      setError(error.message)
      load()
    }
  }

  const addBack = async (linkId: string) => {
    const { error } = await db.rpc('add_back', { link_id: linkId })
    if (error) setError(error.message)
    else load()
  }

  const invite = async (r: Row) => {
    const link = `${window.location.origin}/join/${r.invite_token}`
    const text = `I've added you as my trusted contact on phoney, the app I use for calls when I'm out alone. `
      + `Please accept so you can be told if I need help: ${link}`
    if (navigator.share) {
      try { await navigator.share({ text }) } catch { /* closed the share sheet */ }
    } else {
      await navigator.clipboard.writeText(text)
      setCopied(r.id)
      setTimeout(() => setCopied(''), 2000)
    }
  }

  return (
    <>
      <Notice>
        No messages or notifications yet: contacts who joined see your calls and transcripts in their History
        tab, following the timing you pick below.
      </Notice>
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content/70">
        <span className="flex-1 truncate">Signed in as {userName(session)}</span>
        <button className="btn btn-ghost btn-xs gap-1" onClick={() => signOut()}>
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
      {error && <div role="alert" className="alert alert-error text-sm font-semibold">{error}</div>}

      {rows === null && !error && <div className="flex justify-center py-4"><span className="loading loading-dots" /></div>}
      {rows?.map((c) => (
        <div key={c.id} className="flex items-center gap-3 bg-base-200 border-2 border-base-300 rounded-box p-3">
          <div className="w-10 h-10 rounded-full bg-secondary/15 text-secondary grid place-items-center font-extrabold">
            {c.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold flex items-center gap-2">
              {c.name}
              <span className={`badge badge-sm font-bold ${c.joined_at ? 'badge-success' : 'badge-ghost'}`}>
                {c.joined_at ? 'Joined' : 'Invited'}
              </span>
            </div>
            <div className="text-xs text-base-content/60 font-semibold truncate">
              {[c.phone, c.email].filter(Boolean).join(' · ')}
            </div>
            <select
              className="select select-ghost select-xs w-full -ml-2 text-xs text-base-content/70 font-semibold"
              aria-label={`When to alert ${c.name}`}
              value={c.delay_min}
              onChange={(e) => setDelay(c.id, Number(e.target.value))}
            >
              {DELAYS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
            </select>
          </div>
          {!c.joined_at && (
            <button className="btn btn-ghost btn-sm gap-1" onClick={() => invite(c)}>
              <Send className="w-4 h-4" /> {copied === c.id ? 'Copied' : 'Invite'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm btn-circle" aria-label="Remove" onClick={() => remove(c.id)}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}

      <section className="space-y-2 bg-base-200 rounded-box p-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60">Add someone</h2>
        <input className="input w-full font-semibold" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input w-full font-semibold" placeholder="Phone (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className="input w-full font-semibold" placeholder="Their Google email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="text-xs text-base-content/60 font-semibold">
          With an email they're linked automatically when they sign up; otherwise send them the invite link.
        </p>
        <select className="select w-full font-semibold" value={delayMin} onChange={(e) => setDelayMin(Number(e.target.value))}>
          {DELAYS.map((d) => <option key={d.min} value={d.min}>{d.label}</option>)}
        </select>
        <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold gap-2" onClick={add}>
          <UserPlus className="w-5 h-5" /> Add contact
        </button>
      </section>

      {people.length > 0 && (
        <section className="space-y-1 bg-base-200 rounded-box p-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60">You're a trusted contact for</h2>
          {people.map((p) => (
            <div key={p.link_id} className="flex items-center gap-2 min-h-8">
              <span className="flex-1 font-extrabold truncate">{p.owner_name}</span>
              {p.added_back ? (
                <span className="text-xs font-bold text-base-content/60">Also your contact</span>
              ) : (
                <button className="btn btn-secondary btn-sm rounded-xl font-extrabold gap-1" onClick={() => addBack(p.link_id)}>
                  <UserPlus className="w-4 h-4" /> Add back
                </button>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  )
}
