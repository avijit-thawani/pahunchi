// Incoming-call ringtone, synthesized: a soft four-note phrase every 2.5 s. Plays only if the
// page has had a tap (autoplay rules); vibrates where supported.

const NOTES = [659.25, 783.99, 987.77, 783.99] // E5 G5 B5 G5
const NOTE_S = 0.16
const CYCLE_S = 2.5

export function startRingtone(): () => void {
  const ctx = new AudioContext()
  const out = new GainNode(ctx, { gain: 0.25 })
  out.connect(ctx.destination)
  let next = ctx.currentTime + 0.1
  const schedule = () => {
    while (next < ctx.currentTime + CYCLE_S * 2) {
      for (let rep = 0; rep < 2; rep++) {
        NOTES.forEach((f, i) => {
          const t = next + rep * 0.8 + i * NOTE_S
          const osc = new OscillatorNode(ctx, { type: 'triangle', frequency: f })
          const env = new GainNode(ctx, { gain: 0 })
          env.gain.setValueAtTime(0, t)
          env.gain.linearRampToValueAtTime(1, t + 0.01)
          env.gain.exponentialRampToValueAtTime(0.001, t + NOTE_S * 1.8)
          osc.connect(env).connect(out)
          osc.start(t)
          osc.stop(t + NOTE_S * 2)
        })
      }
      next += CYCLE_S
    }
  }
  void ctx.resume().then(schedule).catch(() => undefined)
  const timer = setInterval(schedule, 1000)
  const buzz = () => navigator.vibrate?.([800, 400, 800])
  buzz()
  const buzzer = setInterval(buzz, CYCLE_S * 1000)
  return () => {
    clearInterval(timer)
    clearInterval(buzzer)
    navigator.vibrate?.(0)
    void ctx.close().catch(() => undefined)
  }
}
