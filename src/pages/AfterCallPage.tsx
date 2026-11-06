import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Home, ShieldCheck, ThumbsDown, ThumbsUp } from 'lucide-react'
import { getSession, markSafe, setFeedback, useContacts, type Feedback } from '../lib/store.ts'
import { sendFeedback } from '../lib/api.ts'

/** Optional: thumbs up/down, then an optional note. Goes to the call's server log and local history. */
function CallFeedback({ id, initial }: { id: string; initial?: Feedback }) {
  const [rating, setRating] = useState<Feedback['rating'] | undefined>(initial?.rating)
  const [note, setNote] = useState(initial?.note ?? '')
  const [sent, setSent] = useState(!!initial?.note)

  const save = (r: Feedback['rating'], n?: string) => {
    const fb = setFeedback(id, r, n)
    sendFeedback(id, { rating: fb.rating, note: fb.note, at: new Date(fb.at).toISOString() })
  }

  return (
    <div className="bg-base-200 rounded-box p-4 space-y-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold text-sm">How did the call feel?</span>
        <div className="flex gap-2">
          {(['up', 'down'] as const).map((r) => {
            const Icon = r === 'up' ? ThumbsUp : ThumbsDown
            return (
              <button
                key={r}
                aria-label={r === 'up' ? 'Good call' : 'Bad call'}
                data-selected={rating === r}
                onClick={() => {
                  setRating(r)
                  setSent(false)
                  save(r, note)
                }}
                className="pick w-12 h-12 grid place-items-center"
              >
                <Icon className={`w-5 h-5 ${rating === r ? (r === 'up' ? 'text-success' : 'text-error') : ''}`} />
              </button>
            )
          })}
        </div>
      </div>
      {rating && (
        sent ? (
          <p className="text-sm font-semibold text-base-content/60">Thanks, noted.</p>
        ) : (
          <div className="space-y-2">
            <textarea
              className="textarea w-full font-semibold"
              rows={2}
              placeholder={rating === 'up' ? 'What felt real? (optional)' : 'What felt off? (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              disabled={!note.trim()}
              onClick={() => {
                save(rating, note)
                setSent(true)
              }}
              className="btn btn-sm btn-chunky rounded-xl font-extrabold"
            >
              Send note
            </button>
          </div>
        )
      )}
    </div>
  )
}

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
    <main className="max-w-md mx-auto px-6 min-h-dvh flex flex-col justify-center gap-6 text-center pt-8 pb-28">
      {session.safeAt ? (
        <>
          <div className="mx-auto w-24 h-24 rounded-full bg-success/15 grid place-items-center">
            <ShieldCheck className="w-14 h-14 text-success" />
          </div>
          <h1 className="text-3xl font-extrabold">Glad you're home</h1>
          <p className="text-base-content/70 font-semibold">Your contacts won't be notified about this call.</p>
        </>
      ) : (
        <>
          <div className="text-6xl">🏠</div>
          <h1 className="text-3xl font-extrabold">Did you reach safely?</h1>
          <p className="text-base-content/70 font-semibold">
            {minutes} min with {session.name}.{' '}
            {contacts.length ? "Contacts get a nudge if you don't confirm (coming soon)." : ''}
          </p>
          <button onClick={safe} className="btn btn-success btn-chunky btn-lg h-16 rounded-2xl text-lg font-extrabold">
            I'm safe
          </button>
        </>
      )}
      <CallFeedback id={id} initial={session.feedback} />
      {session.safeAt ? (
        <Link to="/" className="btn btn-chunky btn-lg rounded-2xl font-extrabold gap-2">
          <Home className="w-5 h-5" /> Home
        </Link>
      ) : (
        <div className="flex justify-center gap-6 text-sm font-bold">
          <Link className="link link-hover text-secondary" to="/">Home</Link>
          <Link className="link link-hover text-secondary" to="/history">History</Link>
        </div>
      )}
    </main>
  )
}
