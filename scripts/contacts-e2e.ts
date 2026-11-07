// Trusted contacts end to end against the phoney Supabase project, as two throwaway accounts:
// she adds a contact, he accepts the invite link, her call shows up for him under the delay rule,
// then both delete themselves with "Delete all my data" (delete_my_account).
//   node scripts/contacts-e2e.ts

import { account, remove } from './e2e-accounts.ts'

const stamp = Date.now()
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
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
    const r = await remove(a)
    check(`"Delete all my data" removes ${who}`, r.ok, r.error)
  }
}
console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
