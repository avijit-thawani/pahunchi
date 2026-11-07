// Trusted contacts end to end against the phoney Supabase project, as two throwaway accounts:
// she adds a contact, he accepts the invite link, her call shows up for him under the delay rule,
// then both delete themselves with "Delete all my data" (delete_my_account).
//   node scripts/contacts-e2e.ts
// Reads VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY from phoney/.env
// (never printed). The service key only creates the accounts and signs them in, as Google would.

import { existsSync, readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function env(name: string): string {
  if (process.env[name]) return process.env[name]!
  for (const f of ['.env', '../.env']) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m?.[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error(`${name} is not set in phoney/.env`)
}

const URL = env('VITE_SUPABASE_URL')
const admin = createClient(URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const stamp = Date.now()
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

async function account(who: string, fullName: string): Promise<{ db: SupabaseClient; id: string }> {
  const email = `phoney-e2e-${who}-${stamp}@example.com`
  const { data: made, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } })
  if (error) throw new Error(`create ${who}: ${error.message}`)
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`link ${who}: ${le.message}`)
  const db = createClient(URL, env('VITE_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
  const { error: ve } = await db.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  if (ve) throw new Error(`sign in ${who}: ${ve.message}`)
  return { db, id: made.user.id }
}

const her = await account('her', 'E2E Her')
const him = await account('him', 'E2E Contact')
try {
  const add = await her.db.from('trusted_contacts').insert({ name: 'E2E Contact', delay_min: 0 }).select('id,invite_token').single()
  check('she adds a contact', !add.error, add.error?.message)
  const token = add.data!.invite_token as string

  const info = await him.db.rpc('invite_info', { token })
  check('invite link shows her name', info.data?.[0]?.owner_name === 'E2E Her', JSON.stringify(info.data ?? info.error?.message))
  const accept = await him.db.rpc('accept_invite', { token })
  check('he accepts the invite', !accept.error, accept.error?.message)

  const mine = await her.db.from('trusted_contacts').select('joined_at').eq('id', add.data!.id).single()
  check('she sees him as Joined', !!mine.data?.joined_at)
  const people = await him.db.rpc('my_people')
  check('he sees her under his people', (people.data ?? []).some((p: { owner_name: string }) => p.owner_name === 'E2E Her'))

  const callId = `e2e-${stamp}`
  const now = new Date().toISOString()
  const call = await her.db.from('calls').upsert({
    id: callId, persona_name: 'Papa', language: 'hinglish', started_at: now, ended_at: now,
    turns: [{ who: 'her', text: 'हाँ पापा।', at: stamp }, { who: 'them', text: 'हाँ बेटा, बोलो।', at: stamp + 1 }],
  })
  check('her call syncs', !call.error, call.error?.message)
  const shared = async () => ((await him.db.rpc('shared_calls')).data ?? []).some((c: { id: string }) => c.id === callId)
  check('"Right away": he sees her call', await shared())

  await her.db.from('trusted_contacts').update({ delay_min: 30 }).eq('id', add.data!.id)
  check('30 min delay: he does not see it yet', !(await shared()))

  const peek = await him.db.from('calls').select('id')
  check('he cannot read her calls table directly', (peek.data ?? []).length === 0)
} finally {
  for (const [who, a] of [['her', her], ['him', him]] as const) {
    const del = await a.db.rpc('delete_my_account')
    const gone = (await admin.auth.admin.getUserById(a.id)).data.user === null
    check(`"Delete all my data" removes ${who}`, !del.error && gone, del.error?.message)
    if (!gone) await admin.auth.admin.deleteUser(a.id)
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
