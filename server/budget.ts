// Daily spend caps, so a bug, a forgotten tab or someone hammering /api can't run up a bill.
// Three buckets per UTC day, each an estimated dollar total kept in Netlify Blobs (a map in dev):
//   - her own: per signed-in account, else per IP (accounts get more; many phones share one mobile IP)
//   - everyone: past it, running calls go on but new calls are refused
// Checks never wait on storage: each warm function instance keeps the last total it saw and writes
// its own spend back after the response. So a cap can be overshot by a few requests, and two
// instances writing at once can lose one's addition. It is a guard, not an invoice.

import { createHash } from 'node:crypto'
import { getStore } from '@netlify/blobs'
import { clientIp } from './limits.ts'

const cap = (name: string, usd: number) => Number(process.env[name]) || usd
/** A busy call costs about $0.006 a minute, so these are hours of talking. */
const caps = () => ({
  ip: cap('PHONEY_CAP_IP_USD', 1),
  user: cap('PHONEY_CAP_USER_USD', 3),
  all: cap('PHONEY_CAP_ALL_USD', 20),
})

// Estimates at list prices (₹89 to the dollar): Sarvam voice ₹1 per 1,000 characters, Sarvam
// speech-to-text ₹30 per hour, and a typical reply from the LLM.
const INR = 1 / 89
export const PRICE = { ttsChar: INR / 1000, sttSecond: (30 * INR) / 3600, reply: 0.0003 }

export type Limit = 'daily' | 'busy'
type Bucket = { known: number; pending: number; loaded: boolean; busy?: Promise<void> }
type Meter = { keys: string[]; defer: (p: Promise<unknown>) => void }

const g = globalThis as { phoneyBudget?: Map<string, number> }
function store(): { get(k: string): Promise<number>; set(k: string, v: number): Promise<void> } {
  if (process.env.NETLIFY_BLOBS_CONTEXT || (globalThis as { netlifyBlobsContext?: unknown }).netlifyBlobsContext) {
    const s = getStore({ name: 'budget', consistency: 'strong' })
    return {
      get: async (k) => Number(((await s.get(k, { type: 'json' })) as { usd?: number } | null)?.usd) || 0,
      set: async (k, v) => void (await s.setJSON(k, { usd: +v.toFixed(6) })),
    }
  }
  const m = (g.phoneyBudget ??= new Map())
  return { get: async (k) => m.get(k) ?? 0, set: async (k, v) => void m.set(k, v) }
}

const buckets = new Map<string, Bucket>()
function bucket(key: string): Bucket {
  if (buckets.size > 20000) buckets.clear()
  let b = buckets.get(key)
  if (!b) buckets.set(key, (b = { known: 0, pending: 0, loaded: false }))
  return b
}

/** Add this instance's unsaved spend to the stored total, and learn what other instances spent. */
function sync(key: string, defer: Meter['defer']) {
  const b = bucket(key)
  if (b.busy) return
  b.busy = (async () => {
    try {
      const s = store()
      // Spend recorded while a write was under way goes in the next round, not lost with the instance.
      for (let round = 0; round < 3 && (round === 0 || b.pending > 0); round++) {
        const mine = b.pending
        const total = (await s.get(key)) + mine
        if (mine > 0) await s.set(key, total)
        b.pending -= mine
        b.known = total
        b.loaded = true
      }
    } catch (e) {
      console.error('[budget]', key, String(e).slice(0, 200))
    } finally {
      b.busy = undefined
    }
  })()
  defer(b.busy)
}

// Signed-in callers send their Supabase access token. It is checked with Supabase once per
// instance, in the background; until that answer arrives the request counts against the IP, so a
// made-up token never buys a fresh allowance.
const verified = new Map<string, { id: string | null; until: number }>()
function account(req: Request, defer: Meter['defer']): string | null {
  const token = /^Bearer (\S+)$/.exec(req.headers.get('Authorization') || '')?.[1]
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  if (!token || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  const hit = verified.get(token)
  if (hit && hit.until > Date.now()) return hit.id
  if (verified.size > 5000) verified.clear()
  verified.set(token, { id: null, until: Date.now() + 60_000 })
  defer(fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  }).then(async (r) => {
    const id = r.ok ? String((await r.json()).id || '') : ''
    if (/^[\w-]{8,64}$/.test(id)) verified.set(token, { id, until: Date.now() + 10 * 60_000 })
  }).catch(() => undefined))
  return null
}

const meters = new WeakMap<Request, Meter>()

/** Call before a paid request (stt, reply, tts). Returns why it must be refused, if it must. */
export function check(req: Request, defer: Meter['defer']): Limit | null {
  const day = new Date().toISOString().slice(0, 10)
  const user = account(req, defer)
  const own = user ? `${day}/user-${user}` : `${day}/ip-${createHash('sha256').update(clientIp(req)).digest('hex').slice(0, 16)}`
  const all = `${day}/all`
  meters.set(req, { keys: [own, all], defer })
  for (const k of [own, all]) if (!bucket(k).loaded) sync(k, defer)
  const spent = (k: string) => bucket(k).known + bucket(k).pending
  const c = caps()
  if (spent(own) >= (user ? c.user : c.ip)) return 'daily'
  // Only the opening line is refused: a call she is already on is never cut off for everyone's total.
  if (spent(all) >= c.all && req.headers.get('X-Phoney-Turn') === '00') return 'busy'
  return null
}

/** Record what a request is about to cost. */
export function spend(req: Request, usd: number) {
  const m = meters.get(req)
  if (!m || !(usd > 0)) return
  for (const k of m.keys) {
    bucket(k).pending += usd
    sync(k, m.defer)
  }
}
