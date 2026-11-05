// All of /api/* as one Netlify Function. The edge gate already checks the password cookie;
// this checks again because functions are also reachable at /.netlify/functions/api.

import { handle } from '../../server/api.ts'
import { isAuthed } from '../../server/auth.ts'

type Context = { waitUntil?: (p: Promise<unknown>) => void }

export default async (req: Request, context: Context): Promise<Response> => {
  const { PHONEY_PASSWORD, PHONEY_COOKIE_SECRET, PHONEY_PUBLIC } = process.env
  if (PHONEY_PUBLIC !== '1' && (!PHONEY_PASSWORD || !PHONEY_COOKIE_SECRET || !(await isAuthed(req, PHONEY_PASSWORD, PHONEY_COOKIE_SECRET)))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
  }
  const name = new URL(req.url).pathname.replace(/^\/api\//, '').split('/')[0]
  const pending: Promise<unknown>[] = []
  const defer = (p: Promise<unknown>) => {
    if (context.waitUntil) context.waitUntil(p)
    else pending.push(p)
  }
  const res = await handle(name, req, defer)
  if (!context.waitUntil) await Promise.allSettled(pending)
  return res
}

export const config = {
  path: '/api/*',
  rateLimit: { windowLimit: 200, windowSize: 60, aggregateBy: ['ip'] },
}
