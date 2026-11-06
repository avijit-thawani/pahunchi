// The Android/iOS app serves the UI from its own origin and calls the deployed /api/* cross-origin.
// Only those app origins are allowed; the website itself is same-origin and needs no headers.

const APP_ORIGINS = new Set(['https://localhost', 'capacitor://localhost'])

function corsHeaders(req: Request): Record<string, string> | null {
  const origin = req.headers.get('Origin')
  if (!origin || !APP_ORIGINS.has(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Phoney-Session, X-Phoney-Turn',
    'Access-Control-Expose-Headers': 'X-Sample-Rate, X-Engine, X-Model, X-Upstream-Ms',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

/** Answers preflights, and adds CORS headers to the handler's response for app origins. */
export async function withCors(req: Request, handler: () => Promise<Response>): Promise<Response> {
  const cors = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} })
  const res = await handler()
  if (!cors) return res
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
