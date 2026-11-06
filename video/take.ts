// Record a real call take for the demo video: her lines are voiced once in the Saheli voice
// (Sarvam aparna, cached), then sent through the running app's /api/stt -> /api/reply -> /api/tts
// exactly like a call. His replies are live; gaps are the measured "her end -> his first sound".
//   npm run dev   (in another terminal)
//   node video/take.ts cab 3        # 3 takes of the cab scene -> video/audio/takes/cab-<n>/
// Each take writes take.json (turns, timings, timeline), her_/him_ wavs and mix.wav.

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Clauses } from '../shared/clauses.ts'
import type { Scene } from '../shared/scene.ts'

const BASE = process.env.PHONEY_URL || 'http://localhost:5173'
const PAUSE_MS = 300
const END_MS = 600
const HER_VOICE = { personaId: 'friend_f', voiceId: 'sarvam:aparna_hi_customer' }
const OUT = 'video/audio'
/** Her thinking time before answering him, in the mix. */
const HER_GAP_S = 0.6

type Line = { tts: string; caption: string }
type Setup = { personaId: string; name: string; language: 'hinglish'; scene?: Scene; her: Line[] }

const SCENES: Record<string, Setup> = {
  cab: {
    personaId: 'dad', name: 'Papa', language: 'hinglish',
    her: [
      { tts: 'हेलो पापा? हाँ, मैं cab में बैठ गई हूँ।', caption: 'Hello Papa? Haan, main cab mein baith gayi hoon.' },
      { tts: 'White Dzire है। डी एल थ्री सी, ए बी, फोर फाइव टू वन।', caption: 'White Dzire hai. DL 3C AB 4521.' },
      { tts: 'बस बीस-पच्चीस मिनट।', caption: 'Bas bees-pachchees minute.' },
    ],
  },
  escape: {
    personaId: 'dad', name: 'Papa', language: 'hinglish', scene: { purpose: 'escape', excuse: 'unwell' },
    her: [
      { tts: 'अच्छा? ठीक है पापा, मैं अभी निकलती हूँ।', caption: 'Achha? Theek hai Papa, main abhi nikalti hoon.' },
    ],
  },
}

type Turn = { who: 'her' | 'them' | 'event'; text: string; at: number }

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

const seconds = (file: string) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }))

async function post(path: string, body: BodyInit, type: string, session: string, turn: string) {
  const r = await fetch(`${BASE}/api/${path}`, {
    method: 'POST', body, headers: { 'Content-Type': type, 'X-Phoney-Session': session, 'X-Phoney-Turn': turn },
  })
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`)
  return r
}

/** Her line in the Saheli voice, cached by text. */
async function herClip(line: Line): Promise<string> {
  mkdirSync(`${OUT}/her`, { recursive: true })
  const file = `${OUT}/her/${createHash('sha1').update(HER_VOICE.voiceId + line.tts).digest('hex').slice(0, 10)}.wav`
  if (existsSync(file)) return file
  const r = await post('tts', JSON.stringify({ ...HER_VOICE, text: line.tts, language: 'hinglish' }), 'application/json', 'video-her', '00')
  writeFileSync(file, wav(Buffer.from(await r.arrayBuffer()), Number(r.headers.get('X-Sample-Rate') || 24000)))
  return file
}

async function take(id: string, setup: Setup, dir: string) {
  mkdirSync(dir, { recursive: true })
  const session = `video-${id}-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}`
  const turns: Turn[] = [{ who: 'event', text: 'call connected', at: Date.now() }]
  const log: Record<string, unknown>[] = []

  /** Stream his reply; every clause goes to TTS as soon as it is complete (first one timed). */
  async function respond(turn: string) {
    const t0 = Date.now()
    const res = await post('reply', JSON.stringify({ personaId: setup.personaId, name: setup.name, language: setup.language, scene: setup.scene, turns }), 'application/json', session, turn)
    const clauses = new Clauses()
    const jobs: Promise<{ pcm: Buffer; rate: number; first: number; engine: string }>[] = []
    let clause = 0
    const speak = (c: string) => {
      if (!jobs.length) clause = Date.now() - t0
      jobs.push((async () => {
        const t = Date.now()
        const audio = await post('tts', JSON.stringify({ personaId: setup.personaId, text: c, language: setup.language }), 'application/json', session, turn)
        const reader = audio.body!.getReader()
        const parts: Uint8Array[] = []
        let first = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!first) first = Date.now() - t
          parts.push(value)
        }
        return { pcm: Buffer.concat(parts), rate: Number(audio.headers.get('X-Sample-Rate') || 24000), first, engine: audio.headers.get('X-Engine') || '?' }
      })())
    }
    let text = ''
    let buf = ''
    const dec = new TextDecoder()
    const reader = res.body!.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop()!
      for (const line of lines.filter(Boolean)) {
        const c = JSON.parse(line)
        if (c.error) throw new Error(c.error)
        if (c.d) clauses.push(c.d).forEach(speak)
        if (c.done) text = c.text
      }
    }
    clauses.flush().forEach(speak)
    turns.push({ who: 'them', text, at: Date.now() })
    const audio = await Promise.all(jobs)
    if (!audio.length) return { text, clause, tts: 0, file: '' }
    const file = `${dir}/him_${turn}.wav`
    writeFileSync(file, wav(Buffer.concat(audio.map((a) => a.pcm)), audio[0].rate))
    return { text, clause, tts: audio[0].first, engine: audio[0].engine, file }
  }

  const open = await respond('00')
  log.push({ turn: '00', who: 'them', ...open })
  console.log(`  THEM ${open.text}`)
  for (const [i, line] of setup.her.entries()) {
    const turn = String(i + 1).padStart(2, '0')
    const clip = await herClip(line)
    const t = Date.now()
    const stt = await (await post('stt', readFileSync(clip), 'audio/wav', session, turn)).json() as { text: string }
    const sttMs = Date.now() - t
    turns.push({ who: 'her', text: stt.text, at: Date.now() })
    log.push({ turn, who: 'her', caption: line.caption, heard: stt.text, file: clip, sttMs })
    console.log(`  HER  ${line.caption}   (heard: ${stt.text})`)
    const r = await respond(turn)
    const totalMs = r.tts ? Math.max(END_MS, PAUSE_MS + sttMs + r.clause + r.tts) : 0
    log.push({ turn, who: 'them', ...r, totalMs })
    console.log(`  THEM ${r.text}   ${r.tts ? `(${totalMs} ms: stt ${sttMs}, llm ${r.clause}, tts ${r.tts})` : '(silent)'}`)
  }

  // Timeline: he opens at 0; she answers after HER_GAP_S; he replies after the measured gap.
  let t = 0
  const timeline: { who: string; file: string; start: number; end: number; caption: string; totalMs?: number }[] = []
  for (const e of log) {
    if (!e.file) continue
    const file = e.file as string
    if (e.who === 'her') t += timeline.length ? HER_GAP_S : 0
    else if (e.turn !== '00') t += (e.totalMs as number) / 1000
    const d = seconds(file)
    timeline.push({ who: e.who as string, file, start: +t.toFixed(3), end: +(t + d).toFixed(3), caption: (e.caption || e.text) as string, totalMs: e.totalMs as number | undefined })
    t += d
  }
  mix(timeline, `${dir}/mix.wav`, t + 0.8)
  writeFileSync(`${dir}/take.json`, JSON.stringify({ session, scene: id, turns: log, timeline }, null, 2))
  console.log(`  -> ${dir}/mix.wav (${t.toFixed(1)} s)`)
}

/** Her voice in the room; his through the phone band with the TV bed behind, as the app plays it. */
function mix(timeline: { who: string; file: string; start: number }[], out: string, length: number) {
  const args = ['-v', 'error', '-y']
  const filters: string[] = []
  timeline.forEach((e, i) => {
    args.push('-i', e.file)
    const ms = Math.round(e.start * 1000)
    const chain = e.who === 'them'
      ? 'highpass=f=300,lowpass=f=3400,acompressor=threshold=-24dB:ratio=4:attack=5:release=200,volume=0.9'
      : 'volume=1.0'
    filters.push(`[${i}:a]aresample=44100,${chain},adelay=${ms}:all=1[a${i}]`)
  })
  args.push('-stream_loop', '-1', '-i', 'public/ambience/tv.mp3')
  const tv = timeline.length
  filters.push(`[${tv}:a]aresample=44100,highpass=f=300,lowpass=f=3400,volume=0.06,atrim=0:${length.toFixed(2)}[bed]`)
  filters.push(`${timeline.map((_, i) => `[a${i}]`).join('')}[bed]amix=inputs=${tv + 1}:normalize=0:duration=longest,atrim=0:${length.toFixed(2)},loudnorm=I=-16:TP=-1.5[out]`)
  args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-ac', '1', '-ar', '44100', out)
  execFileSync('ffmpeg', args)
}

const [id = 'cab', n = '1'] = process.argv.slice(2)
const setup = SCENES[id]
if (!setup) throw new Error(`scene ${id}? (${Object.keys(SCENES).join(', ')})`)
for (let k = 1; k <= Number(n); k++) {
  let dir = `${OUT}/takes/${id}-${k}`
  for (let j = k; existsSync(dir); j += 1) dir = `${OUT}/takes/${id}-${j + 1}`
  console.log(`take ${dir}`)
  await take(id, setup, dir)
}
