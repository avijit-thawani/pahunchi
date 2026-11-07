// Add to Home Screen. Chrome/Android fire `beforeinstallprompt` once, early, so it is caught at import time;
// iPhone has no prompt API and needs Share -> Add to Home Screen by hand.

import { useEffect, useState } from 'react'

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

export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent)
export const isAndroid = () => /Android/.test(navigator.userAgent)

/** Signed release APK, attached as pahunchi.apk to each GitHub release (until the Play Store listing). */
export const ANDROID_APK = 'https://github.com/avijit-thawani/pahunchi/releases/latest/download/pahunchi.apk'

/**
 * While mounted, the page advertises the separate "Call" app (public/call.webmanifest), so Add to Home Screen
 * here makes a second icon that opens /go instead of another copy of Pahunchi.
 */
export function useCallManifest() {
  useEffect(() => {
    const swap = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector)
      const old = el?.getAttribute(attr)
      el?.setAttribute(attr, value)
      return () => old != null && el?.setAttribute(attr, old)
    }
    const restore = [
      swap('link[rel="manifest"]', 'href', '/call.webmanifest'),
      swap('link[rel="apple-touch-icon"]', 'href', '/icon-call-192.png'),
      swap('meta[name="apple-mobile-web-app-title"]', 'content', 'Call'),
    ]
    return () => restore.forEach((f) => f())
  }, [])
}

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
