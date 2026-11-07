// "Call me later": each scheduled call is one entry in Netlify Blobs (an in-memory map in dev),
// keyed "<due ms>-<random id>"; knowing the key is what lets her cancel it. deliverDue() runs
// every minute (netlify/functions/ring.ts; in dev, vite.config.ts) and sends due ones as Web Push.

import webpush from 'web-push'
import { getStore } from '@netlify/blobs'
import { PERSONAS } from '../shared/personas.ts'
import { incomingUrl, type Ring } from '../shared/scene.ts'

type PushSub = { endpoint: string; keys: { p256dh: string; auth: string } }
type Scheduled = { at: number; sub: PushSub; ring: Ring }

const MIN_AHEAD_MS = 15_000
const MAX_AHEAD_MS = 24 * 3600_000
const EARLY_MS = 30_000 // the cron is per minute: ring up to 30 s early rather than up to 60 s late
const STALE_MS = 15 * 60_000 // a call this late is pointless; drop it
const TTL_S = 15 * 60
const LANGS = new Set(['hinglish', 'hindi', 'english'])

type Backend = {
  set(key: string, v: Scheduled): Promise<void>
  get(key: string): Promise<Scheduled | null>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

function backend(): Backend {
  if (process.env.NETLIFY_BLOBS_CONTEXT || (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext) {
    const s = getStore({ name: 'schedules', consistency: 'strong' })
    return {
      set: async (k, v) => void (await s.setJSON(k, v)),
      get: (k) => s.get(k, { type: 'json' }),
      delete: (k) => s.delete(k),
      keys: async () => (await s.list()).blobs.map((b) => b.key),
    }
  }
  const g = globalThis as { phoneySchedules?: Map<string, Scheduled> }
  const m = (g.phoneySchedules ??= new Map())
  return {
    set: async (k, v) => void m.set(k, v),
    get: async (k) => m.get(k) ?? null,
    delete: async (k) => void m.delete(k),
    keys: async () => [...m.keys()],
  }
}

function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://pahunchi.netlify.app', pub, priv)
  return pub
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const short = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max

function validRing(r: Ring | undefined): r is Ring {
  return !!r && PERSONAS.some((p) => p.id === r.personaId && p.available) && short(r.name, 40)
    && LANGS.has(r.language) && (r.scene?.purpose === 'escape' || r.scene?.purpose === 'checkin')
    && (r.scene.excuse === undefined || short(r.scene.excuse, 20))
}

function validSub(s: PushSub | undefined): s is PushSub {
  return !!s && short(s.endpoint, 1000) && s.endpoint.startsWith('https://')
    && short(s.keys?.p256dh, 200) && short(s.keys?.auth, 100)
}

const KEY_RE = /^\d{13}-[0-9a-f-]{36}$/

// POST { op: 'key' } -> { key }  |  { op: 'add', at, sub, ring } -> { id }  |  { op: 'cancel', id }
export async function schedule(req: Request): Promise<Response> {
  const body = (await req.json()) as { op?: string; at?: number; sub?: PushSub; ring?: Ring; id?: string }
  if (body.op === 'key') return json({ key: vapid() })
  const store = backend()
  if (body.op === 'cancel') {
    if (!body.id || !KEY_RE.test(body.id)) return json({ error: 'bad id' }, 400)
    await store.delete(body.id)
    return json({ ok: true })
  }
  if (body.op !== 'add') return json({ error: 'bad op' }, 400)
  const ahead = (body.at ?? 0) - Date.now()
  if (!Number.isFinite(ahead) || ahead < MIN_AHEAD_MS || ahead > MAX_AHEAD_MS) return json({ error: 'bad time' }, 400)
  if (!validSub(body.sub) || !validRing(body.ring)) return json({ error: 'bad request' }, 400)
  const at = Math.round(body.at!)
  const id = `${at}-${crypto.randomUUID()}`
  await store.set(id, { at, sub: body.sub, ring: body.ring })
  console.log(`[schedule] add ${id.slice(0, 22)} in ${Math.round(ahead / 1000)}s ${body.ring.scene.purpose}`)
  return json({ id })
}

/** Send every call that is due (and drop stale ones). Returns how many pushes went out. */
export async function deliverDue(now = Date.now()): Promise<number> {
  const store = backend()
  const due = (await store.keys()).filter((k) => KEY_RE.test(k) && Number(k.slice(0, 13)) <= now + EARLY_MS)
  if (!due.length) return 0
  vapid()
  let sent = 0
  await Promise.all(due.map(async (id) => {
    const s = await store.get(id)
    await store.delete(id)
    if (!s) return
    if (now - s.at > STALE_MS) {
      console.log(`[schedule] stale ${id.slice(0, 22)}`)
      return
    }
    const payload = JSON.stringify({ id, title: s.ring.name, body: 'Incoming call · tap to answer', url: incomingUrl(s.ring, id) })
    try {
      await webpush.sendNotification(s.sub, payload, { TTL: TTL_S, urgency: 'high' })
      sent++
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      console.error(`[schedule] push failed ${id.slice(0, 22)} ${status ?? ''} ${String(e).slice(0, 200)}`)
    }
  }))
  console.log(`[schedule] delivered ${sent}/${due.length}`)
  return sent
}
