import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

// Server-only secrets: phoney/.env first, then the shared learn/.env. Never exposed to the client
// (only VITE_* vars are), but loaded into process.env for the /api handlers.
function loadServerEnv(mode: string) {
  for (const dir of [__dirname, path.resolve(__dirname, '..')]) {
    for (const [k, v] of Object.entries(loadEnv(mode, dir, ''))) {
      if (!process.env[k] && v) process.env[k] = v
    }
  }
  process.env.PHONEY_LOG ||= 'local'
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
  return new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  })
}

async function sendResponse(res: ServerResponse, r: Response) {
  res.statusCode = r.status
  r.headers.forEach((v, k) => res.setHeader(k, v))
  if (r.body) {
    const reader = r.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  }
  res.end()
}

// Mounts server/api.ts at /api/<name>, reloaded on every request so edits apply instantly.
// No password gate in dev; that lives in netlify/edge-functions/gate.ts.
function api(): Plugin {
  return {
    name: 'phoney-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api', async (req, res) => {
        const name = (req.url || '').replace(/^\//, '').split('?')[0]
        try {
          const mod = await server.ssrLoadModule('/server/api.ts')
          const defer = (p: Promise<unknown>) => void p.catch(() => undefined)
          await sendResponse(res, await mod.handle(name, await toRequest(req), defer))
        } catch (e) {
          console.error('[api]', name, e)
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  loadServerEnv(mode)
  return {
    plugins: [react(), tailwindcss(), api(), ...(process.env.PHONEY_HTTPS ? [basicSsl()] : [])],
    server: { open: false },
  }
})
