// Location sharing during a call (setting `shareLocation`, signed in only). Points go to
// call_locations; contacts see them under the same delay rule as the call (shared_call_path()).
// The Android/iOS app keeps tracking with the screen off through a foreground service (it shows a
// "sharing your location" notification); the web app only while phoney is on screen.

import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import { LocalNotifications } from '@capacitor/local-notifications'
import { supabase } from './supabase.ts'

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

const UPLOAD_EVERY_MS = 15_000
const RETRY_FIRST_MS = 3_000
const MIN_GAP_MS = 10_000
const MIN_MOVE_M = 20
/** A cold GPS start indoors takes ~15 s, longer than many calls; an older last-known fix still beats none. */
const MAX_STALE_MS = 5 * 60_000

type Point = { call_id: string; at: string; lat: number; lng: number; accuracy_m: number | null }

let callId = ''
let stopWatch: (() => void) | null = null
let timer: ReturnType<typeof setInterval> | undefined
let buffer: Point[] = []
let last: Point | null = null
let sent = false
/** Bumped by stopSharing, so a start still waiting on permission knows the call already ended. */
let gen = 0

function metres(a: Point, b: Point) {
  const rad = Math.PI / 180
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * 6_371_000
}

function record(lat: number, lng: number, accuracy: number | null, time: number) {
  const p: Point = { call_id: callId, at: new Date(time).toISOString(), lat, lng, accuracy_m: accuracy }
  const moved = last && metres(last, p) >= Math.max(MIN_MOVE_M, accuracy ?? 0)
  if (last && Date.parse(p.at) - Date.parse(last.at) < MIN_GAP_MS && !moved) return
  const first = !last
  last = p
  buffer.push(p)
  if (first) void upload()
}

/** PostgREST insert, skipping points already stored. */
async function insert(batch: Point[]): Promise<string | undefined> {
  if (!Capacitor.isNativePlatform()) {
    const { error } = await supabase!.from('call_locations').upsert(batch, { ignoreDuplicates: true })
    return error?.message
  }
  // Android throttles WebView requests a few minutes into the background; native HTTP isn't
  const token = (await supabase!.auth.getSession()).data.session?.access_token
  if (!token) return 'signed out'
  const r = await CapacitorHttp.post({
    url: `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/call_locations`,
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    data: batch,
  })
  return r.status < 300 ? undefined : `${r.status} ${JSON.stringify(r.data).slice(0, 200)}`
}

async function upload() {
  if (!supabase || !buffer.length) return
  const batch = buffer
  buffer = []
  // the call row may not have synced yet (foreign key); keep the points for the next try
  const error = await insert(batch).catch(String)
  if (error) {
    buffer = [...batch, ...buffer].slice(-500)
    console.warn('[location]', error)
    if (!sent && callId) setTimeout(() => void upload(), RETRY_FIRST_MS)
  } else sent = true
}

async function watchNative() {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'phoney is sharing your location',
      backgroundMessage: 'With your trusted contacts, until the call ends.',
      requestPermissions: true,
      stale: true,
      // Android's smallest displacement withholds every fix while she stands still; record() thins them
      distanceFilter: 0,
    },
    (loc, err) => {
      if (err) return console.warn('[location]', err.code, err.message)
      const time = loc?.time ?? Date.now()
      if (loc && Date.now() - time < MAX_STALE_MS) record(loc.latitude, loc.longitude, loc.accuracy ?? null, time)
    },
  )
  return () => void BackgroundGeolocation.removeWatcher({ id })
}

function watchWeb() {
  if (!navigator.geolocation) return () => undefined
  const id = navigator.geolocation.watchPosition(
    (p) => record(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.timestamp),
    (e) => console.warn('[location]', e.message),
    { enableHighAccuracy: true, maximumAge: 10_000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

/** From the settings toggle, so the permission prompt never interrupts a call. */
export async function askPermission(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    // Android 13+: without it the "sharing your location" notice is hidden (tracking still works)
    await LocalNotifications.requestPermissions().catch(() => undefined)
    let answer: (ok: boolean) => void = () => undefined
    const result = new Promise<boolean>((resolve) => (answer = resolve))
    const id = await BackgroundGeolocation.addWatcher({ requestPermissions: true, stale: true }, (loc, err) => {
      if (err || loc) answer(!err)
    })
    const ok = await result
    void BackgroundGeolocation.removeWatcher({ id })
    return ok
  }
  if (!navigator.geolocation) return false
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(() => resolve(true), (e) => resolve(e.code !== e.PERMISSION_DENIED), {
      maximumAge: 600_000, timeout: 15_000,
    })
  })
}

/** Call at call start. Asks for location permission the first time. Never throws. */
export async function startSharing(id: string) {
  stopSharing()
  const mine = gen
  if (!supabase || !(await supabase.auth.getSession()).data.session || mine !== gen) return
  callId = id
  last = null
  sent = false
  try {
    const stop = Capacitor.isNativePlatform() ? await watchNative() : watchWeb()
    if (mine !== gen) return stop()
    stopWatch = stop
    timer = setInterval(() => void upload(), UPLOAD_EVERY_MS)
  } catch (e) {
    console.warn('[location]', e)
  }
}

export function stopSharing() {
  gen++
  stopWatch?.()
  stopWatch = null
  clearInterval(timer)
  callId = ''
  void upload()
}
