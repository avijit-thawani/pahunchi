// Everything the user hears: the responder's voice and room ambience through a phone-band
// chain, plus the ringback tone. One instance per call, created inside the Call tap
// (browsers only allow audio after a user gesture).

const PCM_RATE = 24000 // default when the server sends no X-Sample-Rate
const MIN_CHUNK_S = 0.1 // schedule PCM in >=100 ms pieces to avoid clicks

export class CallAudio {
  readonly ctx: AudioContext
  private input: GainNode
  private master: GainNode
  private playhead = 0
  private sources = new Set<AudioScheduledSourceNode>()
  private ambience?: AudioBufferSourceNode

  constructor() {
    this.ctx = new AudioContext()
    const hp = new BiquadFilterNode(this.ctx, { type: 'highpass', frequency: 300, Q: 0.7 })
    const lp = new BiquadFilterNode(this.ctx, { type: 'lowpass', frequency: 3400, Q: 0.7 })
    const comp = new DynamicsCompressorNode(this.ctx, { threshold: -24, ratio: 4, attack: 0.005, release: 0.2 })
    this.input = new GainNode(this.ctx)
    this.master = new GainNode(this.ctx, { gain: 1 })
    this.input.connect(hp).connect(lp).connect(comp).connect(this.master).connect(this.ctx.destination)
  }

  resume() {
    return this.ctx.resume()
  }

  setVolume(v: number) {
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  /** True while responder audio is scheduled or playing. */
  get speaking(): boolean {
    return this.ctx.currentTime < this.playhead
  }

  private track(src: AudioScheduledSourceNode) {
    this.sources.add(src)
    src.onended = () => this.sources.delete(src)
  }

  /** Indian ringback: 400 Hz tone, 0.4 s on, 0.2 s off, 0.4 s on, 2 s off. */
  ringback(cycles: number): Promise<void> {
    const t0 = this.ctx.currentTime + 0.1
    const osc = new OscillatorNode(this.ctx, { frequency: 400 })
    const env = new GainNode(this.ctx, { gain: 0 })
    osc.connect(env).connect(this.input)
    for (let i = 0; i < cycles; i++) {
      const c = t0 + i * 3
      for (const [on, off] of [[0, 0.4], [0.6, 1.0]]) {
        env.gain.setValueAtTime(0.18, c + on)
        env.gain.setValueAtTime(0, c + off)
      }
    }
    osc.start(t0)
    osc.stop(t0 + cycles * 3)
    this.track(osc)
    return new Promise((resolve) => setTimeout(resolve, (cycles * 3 - 1.6) * 1000))
  }

  async startAmbience(url: string, gain = 0.06) {
    const buf = await this.ctx.decodeAudioData(await (await fetch(url)).arrayBuffer())
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf, loop: true })
    const g = new GainNode(this.ctx, { gain: 0 })
    src.connect(g).connect(this.input)
    g.gain.setTargetAtTime(gain, this.ctx.currentTime, 1.5)
    src.start()
    this.ambience = src
  }

  pcmToBuffer(bytes: Uint8Array, rate = PCM_RATE): AudioBuffer {
    const n = Math.floor(bytes.length / 2)
    const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2)
    const buf = this.ctx.createBuffer(1, Math.max(1, n), rate)
    const ch = buf.getChannelData(0)
    for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768
    return buf
  }

  private schedule(buf: AudioBuffer) {
    const src = new AudioBufferSourceNode(this.ctx, { buffer: buf })
    src.connect(this.input)
    const at = Math.max(this.playhead, this.ctx.currentTime + 0.03)
    src.start(at)
    this.playhead = at + buf.duration
    this.track(src)
  }

  /** Queue a decoded clip after whatever is already playing. */
  play(buf: AudioBuffer) {
    this.schedule(buf)
  }

  /** Stream 16-bit PCM from a fetch Response into the queue; resolves once all bytes are scheduled. */
  async playPcmStream(res: Response, onFirstAudio?: () => void): Promise<void> {
    if (!res.body) return
    const rate = Number(res.headers.get('X-Sample-Rate')) || PCM_RATE
    const minBytes = Math.round(rate * MIN_CHUNK_S) * 2
    const reader = res.body.getReader()
    let pending = new Uint8Array(0)
    let first = true
    for (;;) {
      const { done, value } = await reader.read()
      if (value) {
        const merged = new Uint8Array(pending.length + value.length)
        merged.set(pending)
        merged.set(value, pending.length)
        pending = merged
      }
      const usable = done || pending.length >= minBytes ? pending.length - (pending.length % 2) : 0
      if (usable > 0) {
        this.schedule(this.pcmToBuffer(pending.subarray(0, usable), rate))
        pending = pending.slice(usable)
        if (first) {
          first = false
          onFirstAudio?.()
        }
      }
      if (done) break
    }
  }

  /** Resolves when everything queued so far has finished playing. */
  drained(): Promise<void> {
    const ms = Math.max(0, (this.playhead - this.ctx.currentTime) * 1000)
    return new Promise((r) => setTimeout(r, ms + 50))
  }

  close() {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.ambience?.stop()
    void this.ctx.close()
  }
}
