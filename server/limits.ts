// Cheap in-memory request caps. Per process (one dev server, or one warm Netlify function
// instance), so they are a guard against runaway loops and casual abuse, not a quota.
// Netlify's own per-IP rateLimit in netlify/functions/api.ts backs this up in production.

const WINDOW_MS = 60_000
const PER_IP_PER_MIN = 150 // a turn is stt + reply + one tts per clause, more with speculative starts
const PER_SESSION = 2500 // ~2 h of a chatty call
const hits = new Map<string, number[]>()
const sessionCounts = new Map<string, number>()

export function clientIp(req: Request): string {
  return req.headers.get('x-nf-client-connection-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || 'local'
}

/** Returns an error message if this request should be refused. */
export function overLimit(req: Request): string | null {
  const now = Date.now()
  const ip = clientIp(req)
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  hits.set(ip, recent)
  if (hits.size > 5000) hits.clear()
  if (recent.length > PER_IP_PER_MIN) return 'too many requests, slow down'

  const session = req.headers.get('X-Phoney-Session')
  if (session) {
    const n = (sessionCounts.get(session) ?? 0) + 1
    sessionCounts.set(session, n)
    if (sessionCounts.size > 5000) sessionCounts.clear()
    if (n > PER_SESSION) return 'this call has hit its request cap; start a new call'
  }
  return null
}
