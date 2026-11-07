import { useCallback, useEffect, useState } from 'react'
import { LogOut, MapPin, Send, Trash2, UserPlus } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { useContacts, useSettings } from '../lib/store.ts'
import { deleteAllData } from '../lib/forget.ts'
import { HowTo, Step } from './HowTo.tsx'
import { askPermission } from '../lib/location.ts'
import { siteUrl } from '../lib/native.ts'
import { signInWithGoogle, signOut, supabase, userName, useSession } from '../lib/supabase.ts'

const DELAYS = [
  { min: 0, label: 'Right away, when a call starts' },
  { min: 30, label: 'If I don\'t check in within 30 min' },
  { min: 60, label: 'If I don\'t check in within 1 hour' },
  { min: 180, label: 'If I don\'t check in within 3 hours' },
]
const WAITS = [30, 60, 180]

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

export default function SettingsPage() {
  const session = useSession()
  const [local] = useContacts()
  const [count, setCount] = useState(0)
  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-6">
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
      <HowTo tab="settings" done={count + local.length > 0} title="How trusted contacts work">
        <Step icon="👥" title="Add someone you trust">Sign in, add them below, and send them the invite link.</Step>
        <Step icon="⏱️" title="When they see your calls">Right away, or only if you don't tap "I'm safe" in time.</Step>
        <Step icon="📍" title="Your location">Turn it on to show them where you are, on the same delay.</Step>
        <Step icon="🗑️" title="Your data">Delete everything phoney saved, anytime, at the bottom.</Step>
      </HowTo>
      <section className="space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-extrabold">Trusted contacts</h2>
            <span className="badge badge-warning badge-sm font-extrabold">Beta</span>
          </div>
          <p className="text-sm font-semibold text-base-content/70">
            They'll see your call if you don't check in. <b>Alerts aren't live yet</b>, so nobody is notified for now.
          </p>
        </div>
        {!supabase ? (
          <Notice>Accounts aren't configured on this build.</Notice>
        ) : session === undefined ? (
          <div className="flex justify-center py-8"><span className="loading loading-dots" /></div>
        ) : session ? (
          <SignedIn session={session} onCount={setCount} />
        ) : (
          <SignedOut />
        )}
      </section>
      <YourData />
    </main>
  )
}

function YourData() {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle')
  const [error, setError] = useState('')
  const run = async () => {
    setStep('busy')
    setError('')
    try {
      await deleteAllData()
      window.location.assign('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStep('confirm')
    }
  }
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-extrabold">Your data</h2>
      <p className="text-sm font-semibold text-base-content/70">
        Calls are recorded during the beta to improve phoney. <Link to="/privacy" className="link font-bold">Privacy</Link>
      </p>
      {step === 'idle' ? (
        <button onClick={() => setStep('confirm')} className="btn btn-outline btn-error w-full rounded-2xl font-extrabold gap-2">
          <Trash2 className="w-5 h-5" /> Delete all my data
        </button>
      ) : (
        <div className="space-y-3 rounded-box border-2 border-error/50 bg-error/10 p-4">
          <p className="text-sm font-semibold">
            This deletes your call recordings, transcripts and feedback, scheduled calls, your account and trusted
            contacts, and everything phoney saved on this phone. It can't be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={run} disabled={step === 'busy'} className="btn btn-error flex-1 rounded-xl font-extrabold">
              {step === 'busy' ? <span className="loading loading-spinner loading-sm" /> : 'Delete everything'}
            </button>
            <button onClick={() => setStep('idle')} disabled={step === 'busy'} className="btn btn-ghost rounded-xl font-extrabold">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm font-bold text-error">{error}</p>}
    </section>
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
        Sign in so your contacts can be told if you don't check in. Calls work without an account.
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

function ShareLocation() {
  const [settings, setSettings] = useSettings()
  const [note, setNote] = useState('')
  const toggle = async (on: boolean) => {
    setNote('')
    if (on && !(await askPermission())) {
      if (Capacitor.isNativePlatform()) {
        return setNote('Location is blocked for phoney. Allow it in your phone\'s settings, then try again.')
      }
      const site = await navigator.permissions?.query({ name: 'geolocation' }).then((s) => s.state).catch(() => undefined)
      return setNote(site === 'denied'
        ? 'Your browser blocks location for this site. Allow it from the icon beside the address, then try again.'
        : 'Your browser can\'t get your location. Turn on Location Services for it in your device settings, then try again.')
    }
    setSettings({ ...settings, shareLocation: on })
  }
  return (
    <label className="flex items-start gap-3 bg-base-200 rounded-box p-4 cursor-pointer">
      <MapPin className="w-5 h-5 mt-0.5 text-secondary shrink-0" />
      <span className="flex-1">
        <span className="block font-extrabold">Share my location during calls</span>
        <span className="block text-xs font-semibold text-base-content/60">
          Contacts see it on a map with the call, following the same delay.
          {!Capacitor.isNativePlatform() && ' On the website it only updates while phoney is on screen.'}
        </span>
        {note && <span role="alert" className="block text-xs font-bold text-error mt-1">{note}</span>}
      </span>
      <input type="checkbox" className="toggle toggle-secondary" checked={!!settings.shareLocation}
        onChange={(e) => toggle(e.target.checked)} />
    </label>
  )
}

function SignedIn({ session, onCount }: { session: Session; onCount: (n: number) => void }) {
  const db = supabase!
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => onCount(rows?.length ?? 0), [rows, onCount])
  const [people, setPeople] = useState<{ link_id: string; owner_name: string; owner_email?: string | null; added_back: boolean }[]>([])
  const [error, setError] = useState('')
  const [local, setLocal] = useContacts()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [delayMin, setDelayMin] = useState(30)
  const [copied, setCopied] = useState('')

  const load = useCallback(async () => {
    const [c, p, e] = await Promise.all([
      db.from('trusted_contacts').select('id,name,phone,email,delay_min,invite_token,joined_at').order('created_at'),
      db.rpc('my_people'),
      db.rpc('linked_contact_emails'),
    ])
    const linked = new Map<string, string>((e.data ?? []).map((r: { id: string; email: string }) => [r.id, r.email]))
    if (c.error) setError(c.error.message)
    else setRows(c.data.map((r) => ({ ...r, email: linked.get(r.id) ?? r.email })))
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
    const link = `${siteUrl}/join/${r.invite_token}`
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
      <div className="flex items-center gap-2 text-sm font-semibold text-base-content/70">
        <div className="flex-1 min-w-0">
          <div className="truncate">Signed in as {userName(session)}</div>
          {session.user.email && userName(session) !== session.user.email && (
            <div className="truncate text-xs font-normal text-base-content/50">{session.user.email}</div>
          )}
        </div>
        <button className="btn btn-ghost btn-xs gap-1" onClick={() => signOut()}>
          <LogOut className="w-3.5 h-3.5" /> Sign out
        </button>
      </div>
      {error && <div role="alert" className="alert alert-error text-sm font-semibold">{error}</div>}

      <ShareLocation />

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
            {c.phone && <div className="text-xs text-base-content/60 font-semibold truncate">{c.phone}</div>}
            {c.email && <div className="text-xs text-base-content/50 truncate">{c.email}</div>}
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
          <button className="btn btn-ghost btn-sm btn-circle" aria-label="Remove" onClick={() => confirm(`Remove ${c.name}?`) && remove(c.id)}>
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
        <div className="grid grid-cols-2 gap-2">
          <button data-selected={delayMin === 0} onClick={() => setDelayMin(0)} className="pick py-2 text-sm font-extrabold">
            Right away
          </button>
          <button data-selected={delayMin > 0} onClick={() => delayMin === 0 && setDelayMin(30)} className="pick py-2 text-sm font-extrabold">
            If I don't check in
          </button>
        </div>
        {delayMin > 0 && (
          <div className="flex items-center gap-2 text-sm font-semibold text-base-content/70">
            <span>within</span>
            {WAITS.map((m) => (
              <button key={m} data-selected={delayMin === m} onClick={() => setDelayMin(m)} className="pick px-3 py-1 text-sm font-extrabold">
                {m < 60 ? `${m}m` : `${m / 60}h`}
              </button>
            ))}
          </div>
        )}
        <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold gap-2" onClick={add}>
          <UserPlus className="w-5 h-5" /> Add contact
        </button>
      </section>

      {people.length > 0 && (
        <section className="space-y-1 bg-base-200 rounded-box p-4">
          <h2 className="text-sm font-extrabold uppercase tracking-wide text-base-content/60">You're a trusted contact for</h2>
          {people.map((p) => (
            <div key={p.link_id} className="flex items-center gap-2 min-h-8">
              <div className="flex-1 min-w-0">
                <div className="font-extrabold truncate">{p.owner_name}</div>
                {p.owner_email && <div className="text-xs text-base-content/50 truncate">{p.owner_email}</div>}
              </div>
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
