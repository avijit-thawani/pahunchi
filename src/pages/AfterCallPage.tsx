import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Home, ShieldCheck } from 'lucide-react'
import { getSession, markSafe, useContacts } from '../lib/store.ts'

export default function AfterCallPage() {
  const { id = '' } = useParams()
  const [session, setSession] = useState(() => getSession(id))
  const [contacts] = useContacts()

  if (!session) return <main className="p-6">Call not found. <Link className="link" to="/">Home</Link></main>

  const minutes = Math.max(1, Math.round(((session.endedAt ?? session.startedAt) - session.startedAt) / 60000))
  const safe = () => {
    markSafe(id)
    setSession(getSession(id))
  }

  return (
    <main className="max-w-md mx-auto px-6 min-h-dvh flex flex-col justify-center gap-6 text-center">
      {session.safeAt ? (
        <>
          <div className="mx-auto w-24 h-24 rounded-full bg-success/15 grid place-items-center">
            <ShieldCheck className="w-14 h-14 text-success" />
          </div>
          <h1 className="text-3xl font-extrabold">Glad you're home</h1>
          <p className="text-base-content/70 font-semibold">Your contacts won't be notified about this call.</p>
          <Link to="/" className="btn btn-chunky btn-lg rounded-2xl font-extrabold gap-2">
            <Home className="w-5 h-5" /> Home
          </Link>
        </>
      ) : (
        <>
          <div className="text-6xl">🏠</div>
          <h1 className="text-3xl font-extrabold">Did you reach safely?</h1>
          <p className="text-base-content/70 font-semibold">
            {minutes} min call with {session.name}.{' '}
            {contacts.length
              ? `Your ${contacts.length} trusted contact${contacts.length > 1 ? 's' : ''} would be nudged if you don't confirm (coming soon).`
              : "Soon, trusted contacts can be nudged if you don't confirm."}
          </p>
          <button onClick={safe} className="btn btn-success btn-chunky btn-lg h-16 rounded-2xl text-lg font-extrabold">
            I'm safe
          </button>
          <div className="flex justify-center gap-6 text-sm font-bold">
            <Link className="link link-hover text-secondary" to="/">Home</Link>
            <Link className="link link-hover text-secondary" to="/history">History</Link>
          </div>
        </>
      )}
    </main>
  )
}
