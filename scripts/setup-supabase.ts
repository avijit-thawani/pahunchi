// One-time: create the private Storage bucket for deployed call logs (idempotent).
// Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from phoney/.env; never prints them.
//   node scripts/setup-supabase.ts
// No public policies are added, so only the service role (the Netlify function) can read or
// write the bucket.

import { readFileSync } from 'node:fs'

const env = (name: string) =>
  readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim() || ''
const url = env('SUPABASE_URL')
const key = env('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !key) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in phoney/.env')
const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' }

const r = await fetch(`${url}/storage/v1/bucket`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ id: 'phoney-logs', name: 'phoney-logs', public: false, file_size_limit: 10_000_000 }),
})
const text = await r.text()
console.log(r.ok ? 'created bucket phoney-logs' : `create: ${r.status} ${text}`)
const b = await (await fetch(`${url}/storage/v1/bucket/phoney-logs`, { headers })).json()
console.log(`bucket ${b.id}: public=${b.public}, size limit=${b.file_size_limit}`)
