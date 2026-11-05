import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
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
    <main className="max-w-md mx-auto p-6 min-h-dvh flex flex-col justify-center gap-6 text-center">
      {session.safeAt ? (
        <>
          <ShieldCheck size={56} className="mx-auto text-success" />
          <h1 className="text-2xl font-semibold">Glad you're safe</h1>
          <p className="opacity-70 text-sm">
            Nothing will be shared. The call record stays on this device.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-semibold">Did you reach safely?</h1>
          <p className="opacity-70 text-sm">
            {minutes} min call with {session.name}.{' '}
            {contacts.length
              ? `Your ${contacts.length} trusted contact(s) would be nudged if you don't confirm (needs the backend, not active yet).`
              : 'Add trusted contacts to have them nudged if you don\'t confirm.'}
          </p>
          <button onClick={safe} className="btn btn-success btn-lg rounded-full">
            I'm safe
          </button>
        </>
      )}
      <div className="flex justify-center gap-4 text-sm">
        <Link className="link" to="/">Home</Link>
        <Link className="link" to="/history">History</Link>
      </div>
    </main>
  )
}
