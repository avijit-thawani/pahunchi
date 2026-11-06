// Copy the phoney-logs bucket from one Supabase project to another (resumable: objects already in
// the destination are skipped). Reads OLD_SUPABASE_URL + OLD_SUPABASE_SERVICE_ROLE_KEY (source) and SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (destination) from phoney/.env; never prints them.
//   node scripts/move-logs.ts                copy, then compare object counts
//   node scripts/move-logs.ts --delete-old   same, then empty the source bucket if every object arrived

import { readFileSync } from 'node:fs'

const BUCKET = 'phoney-logs'
const env = (name: string) =>
  readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim() || ''
const project = (prefix: string) => {
  const url = env(`${prefix}SUPABASE_URL`)
  const key = env(`${prefix}SUPABASE_SERVICE_ROLE_KEY`)
  if (!url || !key) throw new Error(`set ${prefix}SUPABASE_URL and ${prefix}SUPABASE_SERVICE_ROLE_KEY in phoney/.env`)
  return { url, auth: { Authorization: `Bearer ${key}`, apikey: key } }
}
const src = project('OLD_')
const dst = project('')
if (src.url === dst.url) throw new Error('source and destination are the same project')

type P = ReturnType<typeof project>
type Item = { name: string; id: string | null; metadata?: { mimetype?: string } }

async function list(p: P, prefix = ''): Promise<{ path: string; type: string }[]> {
  const out: { path: string; type: string }[] = []
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`${p.url}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST', headers: { ...p.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix, limit: 1000, offset }),
    })
    if (!r.ok) throw new Error(`list ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const items = (await r.json()) as Item[]
    for (const i of items) {
      const path = prefix ? `${prefix}/${i.name}` : i.name
      if (i.id) out.push({ path, type: i.metadata?.mimetype || 'application/octet-stream' })
      else out.push(...(await list(p, path)))
    }
    if (items.length < 1000) return out
  }
}

async function retry<T>(f: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await f()
    } catch (e) {
      if (i >= tries) throw e
      await new Promise((r) => setTimeout(r, 1000 * i))
    }
  }
}

const files = await list(src)
const present = new Set((await list(dst)).map((f) => f.path))
const todo = files.filter((f) => !present.has(f.path))
console.log(`source: ${files.length} objects, ${todo.length} not yet copied`)
let done = 0
for (let i = 0; i < todo.length; i += 8) {
  await Promise.all(todo.slice(i, i + 8).map((f) => retry(async () => {
    const get = await fetch(`${src.url}/storage/v1/object/${BUCKET}/${f.path}`, { headers: src.auth })
    if (!get.ok) throw new Error(`download ${f.path}: ${get.status}`)
    const put = await fetch(`${dst.url}/storage/v1/object/${BUCKET}/${f.path}`, {
      method: 'POST', headers: { ...dst.auth, 'Content-Type': f.type, 'x-upsert': 'true' }, body: await get.blob(),
    })
    if (!put.ok) throw new Error(`upload ${f.path}: ${put.status} ${(await put.text()).slice(0, 200)}`)
    done++
  })))
  process.stdout.write(`\rcopied ${done}/${todo.length}`)
}
const arrived = new Set((await list(dst)).map((f) => f.path))
const missing = files.filter((f) => !arrived.has(f.path))
console.log(`\ndestination: ${arrived.size} objects, ${missing.length} missing`)

if (process.argv.includes('--delete-old')) {
  if (missing.length) throw new Error('not deleting the source: some objects are missing')
  for (let i = 0; i < files.length; i += 1000) {
    const r = await fetch(`${src.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE', headers: { ...src.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: files.slice(i, i + 1000).map((f) => f.path) }),
    })
    if (!r.ok) throw new Error(`delete ${r.status}: ${(await r.text()).slice(0, 200)}`)
  }
  console.log(`emptied the source bucket (${files.length} objects)`)
}
