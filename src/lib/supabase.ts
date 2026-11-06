// Browser Supabase client (accounts + trusted contacts). Only the public URL and publishable key
// reach the browser; row-level security in supabase/migrations/ decides what each user can touch.

import { useEffect, useState } from 'react'
import { createClient, type Session } from '@supabase/supabase-js'
import { handleAuthRedirects, isNative, nativeSignIn } from './native.ts'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const supabase = url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null

/** undefined while the stored session is loading, null when signed out. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

if (supabase) handleAuthRedirects(supabase)

export function signInWithGoogle() {
  if (supabase && isNative) return nativeSignIn(supabase)
  return supabase?.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  })
}

export const signOut = () => supabase?.auth.signOut()

export function userName(s: Session) {
  const m = s.user.user_metadata
  return (m.full_name || m.name || s.user.email || '') as string
}
