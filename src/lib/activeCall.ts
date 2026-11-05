// The engine must be created inside the Call tap (audio + mic need a user gesture),
// so HomePage starts it and CallPage picks it up here.

import { CallEngine } from './call.ts'
import type { Settings } from './store.ts'

let active: CallEngine | null = null

export function startCall(settings: Settings): CallEngine {
  active?.hangup()
  active = new CallEngine(settings)
  void active.start()
  return active
}

export function activeCall(): CallEngine | null {
  return active
}

export function clearCall() {
  active = null
}
