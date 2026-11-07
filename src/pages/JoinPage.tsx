import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { HeartHandshake } from 'lucide-react'
import { signInWithGoogle, supabase, userName, useSession } from '../lib/supabase.ts'

type Info = { owner_name: string; joined: boolean; mine: boolean }

export default function JoinPage() {
  const { token = '' } = useParams()
  const session = useSession()
  const [info, setInfo] = useState<Info | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!supabase || session === undefined) return
    supabase.rpc('invite_info', { token }).then(({ data, error }) => {
      if (error) setError(error.message)
      setInfo(data?.[0] ?? null)
    })
  }, [token, session, accepted])

  const accept = async () => {
    const { error } = await supabase!.rpc('accept_invite', { token })
    if (error) setError(error.message)
    else setAccepted(true)
  }

  const who = info?.owner_name || 'Someone'
  let body: React.ReactNode
  if (!supabase) body = <p className="font-semibold">Accounts aren't configured on this build.</p>
  else if (info === undefined) body = <span className="loading loading-dots" />
  else if (info === null) body = <p className="font-semibold">This invite link isn't valid. Ask for a new one.</p>
  else if (info.mine) {
    body = (
      <>
        <p className="text-lg font-extrabold">You're {who}'s trusted contact.</p>
        <p className="font-semibold text-base-content/70">
          If {who} starts a call and doesn't confirm she's safe in time, you'll be told so you can check on her.
        </p>
      </>
    )
  } else if (info.joined) body = <p className="font-semibold">Someone has already accepted this invite. Ask {who} for a new link.</p>
  else {
    body = (
      <>
        <p className="text-lg font-extrabold">{who} wants you as a trusted contact on Pahunchi.</p>
        <p className="font-semibold text-base-content/70">
          Pahunchi places a pretend phone call when she's out alone. If she ever doesn't confirm she's safe after one,
          you'll be the one told to check on her.
        </p>
        {session ? (
          <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold" onClick={accept}>
            Accept as {userName(session)}
          </button>
        ) : (
          <button className="btn btn-primary btn-chunky w-full rounded-2xl font-extrabold" onClick={() => signInWithGoogle()}>
            Sign in with Google to accept
          </button>
        )}
      </>
    )
  }

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-28 space-y-4 text-center">
      <HeartHandshake className="w-14 h-14 mx-auto text-secondary" />
      {body}
      {error && <div role="alert" className="alert alert-error text-sm font-semibold">{error}</div>}
      <Link to="/" className="link link-hover text-sm font-semibold text-base-content/60 block">Open Pahunchi</Link>
    </main>
  )
}
