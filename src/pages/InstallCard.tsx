import { useState } from 'react'
import { Share, Smartphone, X } from 'lucide-react'
import { useInstall } from '../lib/install.ts'

const DISMISSED = 'phoney.installDismissed'

/** "Put a Call button on your home screen": the browser's install dialog, or iPhone instructions. */
export default function InstallCard({ name }: { name: string }) {
  const [kind, install] = useInstall()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISSED) === '1')
  const [showSteps, setShowSteps] = useState(false)
  if (!kind || dismissed) return null

  const dismiss = () => {
    localStorage.setItem(DISMISSED, '1')
    setDismissed(true)
  }

  return (
    <div className="relative bg-base-200 rounded-box p-4 space-y-2 text-left">
      <button onClick={dismiss} className="btn btn-ghost btn-xs btn-circle absolute top-2 right-2" aria-label="Not now">
        <X className="w-4 h-4" />
      </button>
      <p className="font-extrabold flex items-center gap-2 pr-6">
        <Smartphone className="w-5 h-5 text-secondary shrink-0" /> One tap to call {name}
      </p>
      <p className="text-sm font-semibold text-base-content/70">
        Add phoney to your home screen. Opening it calls {name} straight away.
      </p>
      {kind === 'prompt' ? (
        <button onClick={() => void install()} className="btn btn-success btn-chunky btn-sm rounded-xl font-extrabold">
          Add to home screen
        </button>
      ) : showSteps ? (
        <p className="text-sm font-bold">
          Tap <Share className="inline w-4 h-4 -mt-1" /> Share at the bottom of Safari, then <b>Add to Home Screen</b>.
        </p>
      ) : (
        <button onClick={() => setShowSteps(true)} className="btn btn-success btn-chunky btn-sm rounded-xl font-extrabold">
          Show me how
        </button>
      )}
    </div>
  )
}
