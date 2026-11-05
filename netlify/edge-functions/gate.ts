// Password gate in front of the whole site, /api included (the OpenRouter key pays for every
// request). Unauthenticated page loads get a login form; API calls get 401. Fails closed
// when PHONEY_PASSWORD / PHONEY_COOKIE_SECRET are missing.

import { checkPassword, isAuthed, loginPage, setCookie } from '../../server/auth.ts'

declare const Netlify: { env: { get(key: string): string | undefined } }

export default async (req: Request): Promise<Response | undefined> => {
  const password = Netlify.env.get('PHONEY_PASSWORD')
  const secret = Netlify.env.get('PHONEY_COOKIE_SECRET')
  if (!password || !secret) return new Response('Site is not configured', { status: 503 })
  const url = new URL(req.url)

  if (url.pathname === '/__login' && req.method === 'POST') {
    const given = String((await req.formData()).get('password') || '')
    if (await checkPassword(given, password, secret)) {
      return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': await setCookie(password, secret) } })
    }
    await new Promise((r) => setTimeout(r, 1000))
    return loginPage('Wrong password', 401)
  }

  if (await isAuthed(req, password, secret)) return undefined
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  return loginPage()
}

export const config = {
  path: '/*',
  rateLimit: { windowLimit: 300, windowSize: 60, aggregateBy: ['ip'] },
}
