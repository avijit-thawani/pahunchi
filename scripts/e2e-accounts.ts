// Throwaway phoney accounts for end-to-end tests: created with the service key and signed in with a
// one-time link, so no Google login is needed. Each test deletes them again with "Delete all my data".
// Reads VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_ROLE_KEY from phoney/.env.

import { existsSync, readFileSync } from 'node:fs'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

export function env(name: string): string {
  if (process.env[name]) return process.env[name]!
  for (const f of ['.env', '../.env']) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m?.[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  throw new Error(`${name} is not set in phoney/.env`)
}

export const SUPABASE_URL = env('VITE_SUPABASE_URL')
/** localStorage key supabase-js keeps the session under, as the app reads it. */
export const AUTH_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`
const admin = createClient(SUPABASE_URL, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

export type Account = { db: SupabaseClient; id: string; session: Session; name: string }

export async function account(who: string, name: string): Promise<Account> {
  const email = `phoney-e2e-${who}-${Date.now()}@example.com`
  const { data: made, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name } })
  if (error) throw new Error(`create ${who}: ${error.message}`)
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (le) throw new Error(`link ${who}: ${le.message}`)
  const db = createClient(SUPABASE_URL, env('VITE_SUPABASE_PUBLISHABLE_KEY'), { auth: { persistSession: false } })
  const { data, error: ve } = await db.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  if (ve || !data.session) throw new Error(`sign in ${who}: ${ve?.message ?? 'no session'}`)
  return { db, id: made.user.id, session: data.session, name }
}

/** "Delete all my data" on the server; true once the account is gone (forced if the RPC failed). */
export async function remove(a: Account): Promise<{ ok: boolean; error?: string }> {
  const del = await a.db.rpc('delete_my_account')
  const gone = (await admin.auth.admin.getUserById(a.id)).data.user === null
  if (!gone) await admin.auth.admin.deleteUser(a.id)
  return { ok: !del.error && gone, error: del.error?.message }
}
