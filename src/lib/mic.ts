// Microphone with a simple energy-based voice activity detector. Emits one 16 kHz WAV per
// utterance (with 300 ms of pre-roll so the first syllable isn't clipped).

const BLOCK_MS = 20
const ONSET_BLOCKS = 4 // 80 ms above threshold starts speech
const END_BLOCKS = 40 // 800 ms below threshold ends it
const PREROLL_MS = 300
const MIN_SPEECH_MS = 300
const MAX_UTTERANCE_MS = 15000

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
}
registerProcessor('phoney-tap', Tap)
`

type Handlers = {
  onSpeechStart?: () => void
  onUtterance: (wav: Blob, speechMs: number) => void
  onLevel?: (rms: number, threshold: number) => void
}

export class Mic {
  muted = false
  /** While true (responder talking) input is ignored, so the speaker's echo isn't treated as her voice. */
  paused = false
  private stream?: MediaStream
  private node?: AudioWorkletNode
  private rate: number
  private blockSize: number
  private block: number[] = []
  private ring: Float32Array[] = []
  private utter: Float32Array[] = []
  private inSpeech = false
  private above = 0
  private below = 0
  private floor = 0.004
  private ctx: AudioContext
  private h: Handlers

  constructor(ctx: AudioContext, handlers: Handlers) {
    this.ctx = ctx
    this.h = handlers
    this.rate = ctx.sampleRate
    this.blockSize = Math.round((this.rate * BLOCK_MS) / 1000)
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    })
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await this.ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.node = new AudioWorkletNode(this.ctx, 'phoney-tap')
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.feed(e.data)
    const sink = new GainNode(this.ctx, { gain: 0 })
    src.connect(this.node).connect(sink).connect(this.ctx.destination)
  }

  private feed(frame: Float32Array) {
    for (let i = 0; i < frame.length; i++) {
      this.block.push(frame[i])
      if (this.block.length === this.blockSize) {
        this.onBlock(Float32Array.from(this.block))
        this.block = []
      }
    }
  }

  private reset() {
    this.inSpeech = false
    this.utter = []
    this.above = this.below = 0
  }

  private onBlock(b: Float32Array) {
    let sum = 0
    for (let i = 0; i < b.length; i++) sum += b[i] * b[i]
    const rms = Math.sqrt(sum / b.length)
    const threshold = Math.max(this.floor * 3.5, 0.012)
    this.h.onLevel?.(rms, threshold)

    if (this.muted || this.paused) {
      this.reset()
      this.ring = []
      return
    }

    if (!this.inSpeech) {
      this.floor = this.floor * 0.97 + Math.min(rms, 0.05) * 0.03
      this.ring.push(b)
      if (this.ring.length > PREROLL_MS / BLOCK_MS) this.ring.shift()
      this.above = rms > threshold ? this.above + 1 : 0
      if (this.above >= ONSET_BLOCKS) {
        this.inSpeech = true
        this.utter = [...this.ring]
        this.ring = []
        this.below = 0
        this.h.onSpeechStart?.()
      }
      return
    }

    this.utter.push(b)
    this.below = rms < threshold * 0.7 ? this.below + 1 : 0
    const ms = this.utter.length * BLOCK_MS
    if (this.below >= END_BLOCKS || ms >= MAX_UTTERANCE_MS) {
      const speechMs = ms - this.below * BLOCK_MS - PREROLL_MS
      const chunks = this.utter
      this.reset()
      if (speechMs >= MIN_SPEECH_MS) this.h.onUtterance(encodeWav(chunks, this.rate), speechMs)
    }
  }

  stop() {
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
  }
}

function encodeWav(chunks: Float32Array[], rate: number, outRate = 16000): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const input = new Float32Array(total)
  let o = 0
  for (const c of chunks) {
    input.set(c, o)
    o += c.length
  }
  const ratio = rate / outRate
  const n = Math.floor(total / ratio)
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const str = (off: number, s: string) => [...s].forEach((ch, i) => v.setUint8(off + i, ch.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, outRate, true)
  v.setUint32(28, outRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const s = input[j] + (input[Math.min(j + 1, total - 1)] - input[j]) * (pos - j)
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}
