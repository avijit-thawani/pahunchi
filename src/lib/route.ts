// Where the call is heard: earpiece, headset or loudspeaker. Only the Android app can choose
// (android/.../AudioRoutePlugin.java); browsers give pages no control, so there it's a no-op.

import { Capacitor, registerPlugin } from '@capacitor/core'

type Route = { route: 'earpiece' | 'speaker' | 'bluetooth' | 'headset' }

type AudioRoutePlugin = {
  start(opts: { speaker: boolean }): Promise<Route>
  setSpeaker(opts: { speaker: boolean }): Promise<Route>
  stop(): Promise<void>
}

const AudioRoute = registerPlugin<AudioRoutePlugin>('AudioRoute')

export const canRoute = Capacitor.getPlatform() === 'android'

export async function startRoute(speaker: boolean) {
  if (canRoute) await AudioRoute.start({ speaker }).catch(() => undefined)
}

export async function setSpeaker(speaker: boolean) {
  if (canRoute) await AudioRoute.setSpeaker({ speaker }).catch(() => undefined)
}

export async function stopRoute() {
  if (canRoute) await AudioRoute.stop().catch(() => undefined)
}
