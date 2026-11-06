// Mirrors calls to Supabase while signed in, so trusted contacts can see them (subject to each
// contact's delay, enforced server-side in shared_calls()). Only names, times and the transcript
// leave the phone; latency metrics and debug events stay local. Failures never affect a call.

import type { Session } from './store.ts'
import { supabase } from './supabase.ts'

const pending = new Map<string, ReturnType<typeof setTimeout>>()
let queue = Promise.resolve()

const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null)

async function upload(s: Session) {
  if (!supabase) return
  const { data } = await supabase.auth.getSession()
  if (!data.session) return
  const { error } = await supabase.from('calls').upsert({
    id: s.id, persona_name: s.name, language: s.language, started_at: iso(s.startedAt),
    ended_at: iso(s.endedAt), safe_at: iso(s.safeAt), turns: s.turns,
  }, { onConflict: 'owner_id,id' })
  if (error) console.warn('[sync]', error.message)
}

/** Upload now, or after `delayMs` (coalescing rapid transcript updates into one write). */
export function syncCall(s: Session, delayMs = 0) {
  clearTimeout(pending.get(s.id))
  const run = () => {
    pending.delete(s.id)
    // in order, so a slow early write can't land after (and overwrite) a later one
    queue = queue.then(() => upload(s)).catch((e) => console.warn('[sync]', e))
  }
  if (delayMs) pending.set(s.id, setTimeout(run, delayMs))
  else run()
}
