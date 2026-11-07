// "Call me later" on the phone: Web Push subscription, scheduling through /api/schedule, and the
// pending list (localStorage) behind the home card. If phoney is open when a call is due, it
// rings in the app (useRingWhenDue); otherwise the push notification does. The Android/iOS app's
// WebView has no Web Push, so there the phone itself schedules the notification instead.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LocalNotifications } from '@capacitor/local-notifications'
import { incomingUrl, type Ring } from '../../shared/scene.ts'
import { isNative } from './native.ts'

export type Pending = { id: string; at: number; ring: Ring; pushed: boolean }

const KEY = 'phoney.later'
const CALL_TAG = 'phoney-call'
/** Still worth ringing if she opens phoney this long after the time. */
const LATE_OK_MS = 10 * 60_000
const NATIVE = 'native-'
const CHANNEL = 'calls'

/** 'ios-install': iPhone Safari tab; push needs Share -> Add to Home Screen first. */
export type PushSupport = 'ok' | 'ios-install' | 'denied' | 'none'

export function pushSupport(): PushSupport {
  if (isNative) return 'ok'
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!has) return ios ? 'ios-install' : 'none'
  return Notification.permission === 'denied' ? 'denied' : 'ok'
}

function read(): Pending[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]') as Pending[]
  } catch {
    return []
  }
}

function write(list: Pending[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
  window.dispatchEvent(new Event('phoney-later'))
}

async function post<T>(body: object): Promise<T> {
  const r = await fetch('/api/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`schedule: ${r.status} ${(await r.text()).slice(0, 120)}`)
  return r.json() as Promise<T>
}

function b64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/** Must run inside a tap: asks for notification permission. */
async function subscription(): Promise<PushSubscriptionJSON> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for phoney.')
  await navigator.serviceWorker.register('/sw.js')
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing.toJSON()
  const { key } = await post<{ key: string }>({ op: 'key' })
  return (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64url(key) })).toJSON()
}

const nativeId = (id: string) => (id.startsWith(NATIVE) ? Number(id.slice(NATIVE.length)) : undefined)

/** Must run inside a tap: asks for notification permission (and, on Android 12+, exact alarms). */
async function scheduleNative(ring: Ring, at: number): Promise<string> {
  if ((await LocalNotifications.requestPermissions()).display !== 'granted') throw new Error('Notifications are blocked for phoney.')
  await LocalNotifications.createChannel({ id: CHANNEL, name: 'Scheduled calls', importance: 5, visibility: 1, vibration: true })
  const n = Math.floor(at / 1000) % 2_000_000_000
  const id = NATIVE + n
  await LocalNotifications.schedule({
    notifications: [{
      id: n,
      title: ring.name,
      body: 'Incoming call · tap to answer',
      channelId: CHANNEL,
      schedule: { at: new Date(at), allowWhileIdle: true },
      autoCancel: true,
      extra: { url: incomingUrl(ring, id) },
    }],
  })
  return id
}

/** Schedule a call; without push support it only rings if phoney is open at that time. */
export async function scheduleCall(ring: Ring, at: number): Promise<Pending> {
  let p: Pending = { id: `local-${at}`, at, ring, pushed: false }
  if (isNative) {
    p = { id: await scheduleNative(ring, at), at, ring, pushed: false }
  } else if (pushSupport() === 'ok') {
    const sub = await subscription()
    const { id } = await post<{ id: string }>({ op: 'add', at, sub, ring })
    p = { id, at, ring, pushed: true }
  }
  write([...read().filter((x) => x.id !== p.id), p].sort((a, b) => a.at - b.at))
  return p
}

export function cancelCall(id: string) {
  const p = read().find((x) => x.id === id)
  write(read().filter((x) => x.id !== id))
  if (p?.pushed) void post({ op: 'cancel', id }).catch(() => undefined)
  const n = nativeId(id)
  if (n !== undefined) void LocalNotifications.cancel({ notifications: [{ id: n }] }).catch(() => undefined)
}

/** "Delete all my data": cancel every scheduled call on the server and drop the push subscription. */
export async function cancelAll() {
  const pushed = read().filter((p) => p.pushed)
  write([])
  await Promise.all(pushed.map((p) => post({ op: 'cancel', id: p.id })))
  if (isNative) {
    const { notifications } = await LocalNotifications.getPending()
    if (notifications.length) await LocalNotifications.cancel({ notifications: notifications.map((x) => ({ id: x.id })) })
    return
  }
  const reg = await navigator.serviceWorker?.getRegistration()
  await (await reg?.pushManager?.getSubscription())?.unsubscribe()
}

/** It rang (in the app or via the notification): forget it and clear the notification. */
export function rang(id: string) {
  if (read().some((x) => x.id === id)) write(read().filter((x) => x.id !== id))
  const n = nativeId(id)
  if (n !== undefined) {
    void LocalNotifications.cancel({ notifications: [{ id: n }] })
      .then(() => LocalNotifications.removeDeliveredNotificationsById({ ids: [n] }))
      .catch(() => undefined)
    return
  }
  void navigator.serviceWorker?.getRegistration().then((reg) =>
    reg?.getNotifications({ tag: CALL_TAG }).then((ns) => ns.forEach((n) => n.close())))
}

export function usePending(): Pending[] {
  const [list, setList] = useState(read)
  useEffect(() => {
    const sync = () => setList(read().filter((p) => p.at > Date.now() - LATE_OK_MS))
    sync()
    window.addEventListener('phoney-later', sync)
    window.addEventListener('storage', sync)
    const t = setInterval(sync, 15_000)
    return () => {
      window.removeEventListener('phoney-later', sync)
      window.removeEventListener('storage', sync)
      clearInterval(t)
    }
  }, [])
  return list
}

/** App-wide: when a scheduled call is due and phoney is on screen, show the incoming call. */
export function useRingWhenDue() {
  const navigate = useNavigate()
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || location.pathname === '/call' || location.pathname === '/incoming') return
      const now = Date.now()
      const due = read().find((p) => p.at <= now && p.at > now - LATE_OK_MS)
      if (due) navigate(incomingUrl(due.ring, due.id))
    }
    check()
    const t = setInterval(check, 2000)
    document.addEventListener('visibilitychange', check)
    const tapped = isNative
      ? LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
          const url = (notification.extra as { url?: string } | undefined)?.url
          if (url) navigate(url)
        })
      : undefined
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
      void tapped?.then((h) => h.remove())
    }
  }, [navigate])
}
