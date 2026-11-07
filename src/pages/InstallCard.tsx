import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Share, Smartphone, X } from 'lucide-react'
import { ANDROID_APK, isAndroid, isStandalone, useInstall } from '../lib/install.ts'
import { isNative } from '../lib/native.ts'

const DISMISSED = 'phoney.installDismissed'

/** Home-screen setup: Pahunchi itself (install dialog or iPhone steps), plus the separate one-tap Call icon (/go). */
export default function InstallCard({ name }: { name: string }) {
  const [kind, install] = useInstall()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED) === '1')
  const [showSteps, setShowSteps] = useState(false)
  if (dismissed || isNative) return null
  const inApp = isStandalone()

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1')
    setDismissed(true)
  }

  return (
    <div className="relative bg-base-200 rounded-box p-4 space-y-3 text-left">
      <button onClick={dismiss} className="btn btn-ghost btn-xs btn-circle absolute top-2 right-2" aria-label="Not now">
        <X className="w-4 h-4" />
      </button>
      <p className="font-extrabold flex items-center gap-2 pr-6">
        <Smartphone className="w-5 h-5 text-secondary shrink-0" /> Keep Pahunchi one tap away
      </p>
      {isAndroid() ? (
        <a href={ANDROID_APK} className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1 min-w-0 text-sm font-semibold">
            <p className="font-extrabold">Pahunchi for Android</p>
            <p className="text-base-content/70">Keeps the call going with the screen off</p>
          </div>
          <span className="btn btn-success btn-sm rounded-xl font-extrabold">Get</span>
        </a>
      ) : kind && (
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-xl" />
          <div className="flex-1 min-w-0 text-sm font-semibold">
            <p className="font-extrabold">Pahunchi</p>
            {showSteps && (
              <p className="text-base-content/70">
                Tap <Share className="inline w-4 h-4 -mt-1" /> Share in Safari, then <b>Add to Home Screen</b>.
              </p>
            )}
          </div>
          {kind === 'prompt' ? (
            <button onClick={() => void install()} className="btn btn-success btn-sm rounded-xl font-extrabold">Add</button>
          ) : !showSteps && (
            <button onClick={() => setShowSteps(true)} className="btn btn-success btn-sm rounded-xl font-extrabold">How</button>
          )}
        </div>
      )}
      <Link to={inApp ? '/go?setup' : '/go'} className="flex items-center gap-3">
        <img src="/icon-call-192.png" alt="" className="w-10 h-10 rounded-xl" />
        <div className="flex-1 min-w-0 text-sm font-semibold">
          <p className="font-extrabold">Call</p>
          <p className="text-base-content/70">A separate icon that calls {name} right away</p>
        </div>
        <ChevronRight className="w-5 h-5 text-base-content/50" />
      </Link>
    </div>
  )
}
