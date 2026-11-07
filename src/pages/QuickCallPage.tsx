import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Copy, EllipsisVertical, Phone, Share } from 'lucide-react'
import { persona } from '../../shared/personas.ts'
import { getSettings } from '../lib/store.ts'
import { startCall } from '../lib/activeCall.ts'
import { isIOS, isStandalone, useCallManifest } from '../lib/install.ts'

/** Browsers start audio without a tap only for some installed apps; iPhone never does. */
function audioAllowed() {
  try {
    const ctx = new AudioContext()
    const ok = ctx.state === 'running'
    void ctx.close()
    return ok
  } catch {
    return false
  }
}

/**
 * /go. Opened from the "Call" home-screen icon (or Android's long-press "Call now"): calls straight away, or
 * after one tap anywhere if the browser needs it. Opened in a browser tab: how to add that icon.
 */
export default function QuickCallPage() {
  const { search } = useLocation()
  return !isStandalone() || new URLSearchParams(search).has('setup') ? <Setup /> : <CallNow />
}

function useCall() {
  const navigate = useNavigate()
  const settings = getSettings()
  const name = settings.name.trim() || persona(settings.personaId).defaultName
  const started = useRef(false)
  const call = () => {
    if (started.current) return
    started.current = true
    startCall({ ...settings, name })
    navigate('/call', { replace: true })
  }
  return { name, call }
}

function CallNow() {
  const { name, call } = useCall()
  useEffect(() => {
    if (audioAllowed()) call()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <button
      onClick={call}
      className="call-bg fixed inset-0 text-white flex flex-col items-center justify-center gap-6 px-6"
      aria-label={`Call ${name}`}
    >
      <span className="w-28 h-28 rounded-full bg-green-600 grid place-items-center animate-pulse">
        <Phone size={44} />
      </span>
      <span className="text-3xl font-light">Call {name}</span>
      <span className="text-white/60">Tap anywhere</span>
    </button>
  )
}

function Setup() {
  useCallManifest()
  const { name, call } = useCall()
  const [copied, setCopied] = useState(false)
  const inApp = isStandalone()
  const link = `${location.origin}/go`

  return (
    <main className="max-w-md mx-auto px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-28 space-y-5">
      <div className="flex items-center gap-4">
        <img src="/icon-call-192.png" alt="" className="w-16 h-16 rounded-2xl shadow" />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">One-tap Call icon</h1>
          <p className="text-sm font-semibold text-base-content/70">
            A second icon next to Pahunchi. Tapping it calls {name} right away.
          </p>
        </div>
      </div>

      <section className="bg-base-200 rounded-box p-4 space-y-3 text-sm font-semibold">
        {inApp ? (
          <>
            <p>Home-screen icons are added from the browser, not from inside Pahunchi:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Open <b>{link}</b> in {isIOS() ? 'Safari' : 'Chrome'}.</li>
              <li>Add it to your home screen from there.</li>
            </ol>
            <button
              onClick={() => {
                void navigator.clipboard.writeText(link)
                setCopied(true)
              }}
              className="btn btn-sm btn-outline rounded-xl font-extrabold gap-1.5"
            >
              <Copy className="w-4 h-4" /> {copied ? 'Copied' : 'Copy link'}
            </button>
          </>
        ) : isIOS() ? (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <Share className="inline w-4 h-4 -mt-1" /> <b>Share</b> at the bottom of Safari.</li>
            <li>Tap <b>Add to Home Screen</b>. It's already named "Call".</li>
          </ol>
        ) : (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Tap <EllipsisVertical className="inline w-4 h-4 -mt-1" /> in Chrome's top-right corner.</li>
            <li>Tap <b>Add to Home screen</b> (or <b>Install</b>), then <b>Add</b>.</li>
          </ol>
        )}
        <p className="text-xs text-base-content/70">
          It calls whoever is picked on Pahunchi's home page{inApp ? '' : ', using this browser\'s settings'}.
        </p>
      </section>

      <button onClick={call} className="btn btn-success btn-chunky btn-lg w-full h-14 rounded-2xl font-extrabold gap-2">
        <Phone className="w-5 h-5" /> Call {name} now
      </button>
      <Link to="/" className="block text-center text-sm font-bold text-secondary link link-hover">Back to Pahunchi</Link>
    </main>
  )
}
