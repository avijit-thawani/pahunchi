// "Delete all my data" (bottom of Settings). Server copies go first, so if one step fails she
// still has the call ids on this phone and can retry; the phone is wiped last.
//   1. call logs (audio, transcripts, feedback, IP/browser) for every call this phone or her account knows
//   2. scheduled "Call me later" pushes
//   3. her account: calls, trusted contacts, and her link on other people's lists (delete_my_account)
//   4. everything phoney keeps in this browser

import type { Session } from './store.ts'
import { cancelAll } from './later.ts'
import { supabase } from './supabase.ts'

const PREFIX = 'phoney.'

export async function deleteAllData() {
  const local = JSON.parse(localStorage.getItem(`${PREFIX}sessions`) || '[]') as Session[]
  const ids = new Set(local.map((s) => s.id))
  const signedIn = !!supabase && !!(await supabase.auth.getSession()).data.session
  if (signedIn) {
    const { data, error } = await supabase!.from('calls').select('id')
    if (error) throw new Error(error.message)
    for (const c of data) ids.add(c.id as string)
  }

  const r = await fetch('/api/forget', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessions: [...ids] }),
  })
  if (!r.ok) throw new Error(`Couldn't delete call recordings (${r.status}). Try again.`)

  await cancelAll()

  if (signedIn) {
    const { error } = await supabase!.rpc('delete_my_account')
    if (error) throw new Error(error.message)
    await supabase!.auth.signOut({ scope: 'local' })
  }

  for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k)
}
