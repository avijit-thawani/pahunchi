// The Android/iOS app (Capacitor, capacitor.config.ts) runs this same build from https://localhost
// inside a WebView, so anything that relied on the page's own origin needs the real site instead:
// /api/* requests, links she shares, and the Google sign-in redirect (Google refuses sign-in inside
// a WebView, so it opens in the system browser and returns through the AUTH_REDIRECT deep link).

import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import type { SupabaseClient } from '@supabase/supabase-js'

export const isNative = Capacitor.isNativePlatform()

export const siteUrl = isNative
  ? (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://phoney-call.netlify.app'
  : window.location.origin

/** Must match appId in capacitor.config.ts and be listed in Supabase Auth -> URL Configuration. */
export const AUTH_REDIRECT = 'com.avijitthawani.phoney://auth'

/** Native only: send relative /api/ requests to the deployed site (server/cors.ts allows them). */
export function routeApiToSite() {
  if (!isNative) return
  const fetch = window.fetch.bind(window)
  window.fetch = (input, init) =>
    fetch(typeof input === 'string' && input.startsWith('/api/') ? siteUrl + input : input, init)
}

export async function nativeSignIn(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true },
  })
  if (error) throw error
  await Browser.open({ url: data.url, presentationStyle: 'popover' })
}

export function handleAuthRedirects(supabase: SupabaseClient) {
  if (!isNative) return
  void App.addListener('appUrlOpen', async ({ url }) => {
    if (!url.startsWith(AUTH_REDIRECT)) return
    const code = new URL(url).searchParams.get('code')
    void Browser.close().catch(() => undefined)
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) console.warn('[auth]', error.message)
    }
  })
}
