// Shared-password gate for the deployed site. Runs in both Netlify runtimes (Deno edge and
// Node functions), so it only uses Web Crypto. The cookie holds HMAC(secret, password):
// changing either env var logs everyone out.

export const COOKIE = 'phoney_auth'
const MAX_AGE_S = 60 * 60 * 24 * 90

/** Lowercase, and let spaces stand in for hyphens (easier to type on a phone). */
export const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '-')

export async function token(password: string, secret: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(`phoney-v1:${normalize(password)}`)))
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(req: Request, name: string): string {
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return ''
}

function equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function isAuthed(req: Request, password: string, secret: string): Promise<boolean> {
  return equal(readCookie(req, COOKIE), await token(password, secret))
}

export async function checkPassword(given: string, password: string, secret: string): Promise<boolean> {
  return equal(await token(given, secret), await token(password, secret))
}

export async function setCookie(password: string, secret: string): Promise<string> {
  return `${COOKIE}=${await token(password, secret)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; Secure; SameSite=Lax`
}

export function loginPage(error = '', status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>phoney</title><style>
body{font-family:system-ui,sans-serif;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
form{display:grid;gap:12px;width:min(320px,88vw)}h1{font-weight:500;margin:0 0 8px}
input,button{font-size:18px;padding:12px;border-radius:10px;border:1px solid #444;background:#222;color:#eee}
button{background:#16a34a;border:0;color:#fff}p{color:#f87171;margin:0}
</style></head><body><form method="post" action="/__login">
<h1>phoney</h1><input name="password" type="password" placeholder="Password" autocomplete="current-password"
autocapitalize="none" autofocus required>${error ? `<p>${error}</p>` : ''}<button>Enter</button>
</form></body></html>`
  return new Response(html, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
