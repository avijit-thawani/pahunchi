// Add to Home Screen. Chrome/Android fire `beforeinstallprompt` once, early, so it is caught at import time;
// iPhone has no prompt API and needs Share -> Add to Home Screen by hand.

import { useEffect, useState } from 'react'
import { getSettings } from './store.ts'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallPrompt | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferred = e as InstallPrompt
  notify()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  notify()
})

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** Decided once per app launch and cleared by /go, so going back to Home later doesn't redial. */
let pendingLaunch = location.pathname === '/' && !location.search && isStandalone() && getSettings().quickLaunch !== false
export const launchIntoCall = () => pendingLaunch
export const launchDone = () => void (pendingLaunch = false)

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)

/** 'prompt': we can show the browser's install dialog. 'ios': show instructions. null: installed or unsupported. */
export function useInstall(): ['prompt' | 'ios' | null, () => Promise<boolean>] {
  const [, rerender] = useState(0)
  useEffect(() => {
    const f = () => rerender((n) => n + 1)
    listeners.add(f)
    return () => void listeners.delete(f)
  }, [])
  const kind = isStandalone() ? null : deferred ? 'prompt' : isIOS() ? 'ios' : null
  const install = async () => {
    if (!deferred) return false
    await deferred.prompt()
    const { outcome } = await deferred.userChoice
    deferred = null
    notify()
    return outcome === 'accepted'
  }
  return [kind, install]
}
