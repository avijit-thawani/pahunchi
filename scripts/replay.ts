// Replays logged calls as pages: the call's real audio on one timeline (her lines, his clauses,
// fillers) and, per turn, her last word -> his first sound split by pipeline step.
//   node scripts/replay.ts [<id>|latest|all]      -> logs/replay/<id>.html (+ index.html)
//   node scripts/replay-shot.mjs <id> [--video]   -> PNG (and MP4 with the call audio)
// Deployed calls: `node scripts/logs.ts --remote <id>` downloads one into logs/calls/ first.
//
// Steps come from the phone's per-turn metrics (store.ts TurnMetrics), so they add up to the delay
// she heard. The server's own share of each step (from events.jsonl) is drawn solid, the rest
// (upload, network, decode) hatched. Turns without phone metrics (the call ended before he
// finished) use server timings plus the pause wait, drawn dashed and marked "~".

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const CALLS = 'logs/calls'
const OUT = 'logs/replay'
const END_MS = 600
const NET_GUESS_MS = 150

type Ev = { at: string; kind: string; turn?: string; text?: string; ms?: number; firstClauseMs?: number; firstByteMs?: number; seconds?: number; [k: string]: unknown }
type Metrics = { turn?: string; speechMs?: number; vadMs?: number; sttMs?: number; llmMs?: number; ttsFirstByteMs?: number; totalMs?: number; speculative?: boolean }
type Step = { key: 'wait' | 'stt' | 'ai' | 'voice' | 'play'; from: number; to: number; server?: number }
type Clip = { who: 'her' | 'him' | 'filler'; src: string; start: number; dur: number; text?: string; turn?: string }
type Turn = { turn: string; her?: string; him: string; herEnd: number; speechMs?: number; totalMs: number; estimated: boolean; speculative?: boolean; steps: Step[] }
export type Replay = {
  id: string; persona: string; name: string; language: string; voice?: string; device?: string
  durationS: number; clips: Clip[]; turns: Turn[]
}

const jsonl = (f: string): Ev[] => readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const json = (f: string) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined)
const t = (iso: string) => Date.parse(iso)

/** Duration in seconds of a PCM WAV, from its fmt and data chunks. */
function wavSeconds(file: string): number {
  const b = readFileSync(file)
  let rate = 24000, bytesPerSample = 2, channels = 1, data = b.length - 44
  for (let o = 12; o + 8 <= b.length;) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') { channels = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bytesPerSample = b.readUInt16LE(o + 22) / 8 }
    if (id === 'data') { data = Math.min(size, b.length - o - 8); break }
    o += 8 + size + (size % 2)
  }
  return data / rate / bytesPerSample / channels
}

function device(ua?: string): string | undefined {
  if (!ua) return undefined
  if (/Android/.test(ua)) return /wv\)/.test(ua) ? 'Android app' : 'Android browser'
  if (/iPhone|iPad/.test(ua)) return 'iPhone'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Linux/.test(ua)) return 'Linux'
  return ua.slice(0, 30)
}

export function build(id: string): Replay | undefined {
  const dir = path.join(CALLS, id)
  if (!existsSync(path.join(dir, 'events.jsonl'))) return undefined
  const events = jsonl(path.join(dir, 'events.jsonl'))
  const start = json(path.join(dir, 'start.json'))
  const end = json(path.join(dir, 'session.json'))
  const files = readdirSync(dir)
  const t0 = Math.min(...events.map((e) => t(e.at)))
  // Phone clock -> server clock: start.json was received right after the phone stamped startedAt.
  const skew = start?.receivedAt && start?.startedAt ? t(start.receivedAt) - t(start.startedAt) : 0
  const metrics = new Map<string, Metrics>((end?.metrics ?? []).filter((m: Metrics) => m.turn).map((m: Metrics) => [m.turn!, m]))
  const src = (f: string) => `../calls/${id}/${f}`
  const clips: Clip[] = []
  const turns: Turn[] = []

  const labels = [...new Set(events.map((e) => e.turn).filter((x): x is string => !!x && /^\d+$/.test(x)))].sort()
  for (const label of labels) {
    const evs = events.filter((e) => e.turn === label)
    const stt = evs.find((e) => e.kind === 'stt')
    const reply = evs.find((e) => e.kind === 'reply')
    if (!reply || reply.text === '...') continue
    const replyText = String(reply.text)
    const tts = evs.filter((e) => e.kind === 'tts')
    const first = tts.find((e) => replyText.startsWith(String(e.text))) ?? tts[0]
    const m = metrics.get(label)
    const herFile = files.find((f) => f.startsWith(`${label}_her.`))
    const himFiles = files.filter((f) => f.startsWith(`${label}_him_`)).sort()

    let steps: Step[], total: number, vad: number, estimated: boolean
    // The opener's phone metrics start at playback (totalMs ~0), so it always uses server timings.
    if (m?.totalMs && stt) {
      estimated = false
      vad = stt ? (m.vadMs ?? 0) : 0
      total = m.totalMs
      const ai = m.llmMs ?? reply.firstClauseMs ?? 0
      const voice = m.ttsFirstByteMs ?? first?.firstByteMs ?? 0
      const sttSpan = stt ? Math.max(stt.ms ?? 0, total - vad - ai - voice) : 0
      steps = [
        ...(stt ? [{ key: 'wait', from: 0, to: vad } as Step, { key: 'stt', from: vad, to: vad + sttSpan, server: stt.ms } as Step] : []),
        { key: 'ai', from: vad + sttSpan, to: vad + sttSpan + ai, server: reply.firstClauseMs },
        { key: 'voice', from: vad + sttSpan + ai, to: vad + sttSpan + ai + voice, server: first?.firstByteMs },
      ]
      const used = vad + sttSpan + ai + voice
      if (total > used + 20) steps.push({ key: 'play', from: used, to: total })
    } else {
      estimated = true
      vad = stt ? END_MS : 0
      const s = stt ? (stt.ms ?? 0) + NET_GUESS_MS : 0
      const ai = (reply.firstClauseMs ?? 0) + NET_GUESS_MS
      const voice = (first?.firstByteMs ?? 0) + NET_GUESS_MS
      steps = [
        ...(stt ? [{ key: 'wait', from: 0, to: vad } as Step, { key: 'stt', from: vad, to: vad + s, server: stt.ms } as Step] : []),
        { key: 'ai', from: vad + s, to: vad + s + ai, server: reply.firstClauseMs },
        { key: 'voice', from: vad + s + ai, to: vad + s + ai + voice, server: first?.firstByteMs },
      ]
      total = vad + s + ai + voice
    }

    // Anchor on the server clock: STT finished at stt.at (half the network after it, back to the
    // phone); the opening line has no STT, so its reply request started at reply.at - reply.ms.
    const sttStep = steps.find((s) => s.key === 'stt')
    const herEnd = stt && sttStep
      ? t(stt.at) - sttStep.to + (sttStep.to - sttStep.from - (stt.ms ?? 0)) / 2 - t0
      : t(reply.at) - (reply.ms ?? 0) - NET_GUESS_MS / 2 - t0
    if (herFile) {
      const dur = wavSeconds(path.join(dir, herFile))
      // The phone sends the clip after `vad` ms of silence, so the clip ends there.
      clips.push({ who: 'her', src: src(herFile), start: (herEnd + vad) / 1000 - dur, dur, text: stt?.text, turn: label })
    }
    // Clause files are named when their audio started arriving, not in spoken order.
    const him = himFiles.map((f) => {
      const dur = wavSeconds(path.join(dir, f))
      const ev = tts.find((e) => Math.abs((e.seconds ?? 0) - dur) < 0.05)
      const pos = ev ? replyText.indexOf(String(ev.text)) : -1
      return { f, dur, text: ev?.text, pos: pos < 0 ? Infinity : pos }
    }).sort((a, b) => a.pos - b.pos)
    let at = (herEnd + total) / 1000
    for (const h of him) {
      clips.push({ who: 'him', src: src(h.f), start: at, dur: h.dur, text: h.text, turn: label })
      at += h.dur
    }
    turns.push({
      turn: label, her: stt?.text, him: replyText, herEnd: herEnd / 1000, speechMs: m?.speechMs,
      totalMs: Math.round(total), estimated, speculative: m?.speculative, steps,
    })
  }

  const fillerFiles = files.filter((f) => f.startsWith('filler_him_')).sort()
  const fillerEvents = (end?.events ?? []).filter((e: { kind: string }) => e.kind === 'filler')
  fillerEvents.forEach((e: { at: number }, i: number) => {
    const f = fillerFiles[i % Math.max(1, fillerFiles.length)]
    if (!f) return
    clips.push({ who: 'filler', src: src(f), start: (e.at + skew - t0) / 1000, dur: wavSeconds(path.join(dir, f)), text: 'filler' })
  })

  const lastEv = Math.max(...events.map((e) => t(e.at)))
  const durationS = Math.max((lastEv - t0) / 1000, ...clips.map((c) => c.start + c.dur)) + 0.5
  return {
    id, persona: end?.personaId ?? start?.personaId ?? '?', name: end?.name ?? start?.name ?? '', language: end?.language ?? start?.language ?? '',
    voice: end?.voiceId ?? start?.voiceId, device: device(start?.userAgent ?? end?.userAgent), durationS: +durationS.toFixed(2),
    clips: clips.sort((a, b) => a.start - b.start), turns,
  }
}

const TEMPLATE = readFileSync(new URL('./replay.html', import.meta.url), 'utf8')

function page(r: Replay): string {
  return TEMPLATE.replace('/*DATA*/null', JSON.stringify(r).replace(/</g, '\\u003c')).replace('<title>phoney replay</title>', `<title>${r.id} replay</title>`)
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN)

const COLORS = { wait: '#6b7280', stt: '#be8cff', ai: '#ff8c3c', voice: '#5adc78', play: '#4b5563' }
const SCALE_MS = 5000

/** Real calls only: her turns with phone timings; per-step medians as one bar per call. */
function index(rs: Replay[]): string {
  const rows = rs.map((r) => {
    const real = r.turns.filter((x) => !x.estimated && x.her)
    if (!real.length) return ''
    const segs = (Object.keys(COLORS) as (keyof typeof COLORS)[]).map((k) => {
      const ms = median(real.map((x) => { const s = x.steps.find((y) => y.key === k); return s ? s.to - s.from : 0 }))
      return ms > 0 ? `<i title="${k} ${Math.round(ms)} ms" style="width:${(100 * ms) / SCALE_MS}%;background:${COLORS[k]}">${ms > 450 ? (ms / 1000).toFixed(1) : ''}</i>` : ''
    }).join('')
    return `<tr><td><a href="${r.id}.html">${r.id}</a></td><td>${r.name}</td><td>${r.device ?? ''}</td><td>${real.length}</td>` +
      `<td><b>${(median(real.map((x) => x.totalMs)) / 1000).toFixed(1)} s</b></td><td class="bar">${segs}</td></tr>`
  }).join('\n')
  const legend = Object.entries(COLORS).map(([k, c]) => `<span><i style="background:${c}"></i>${{ wait: 'pause wait', stt: 'speech-to-text', ai: 'AI first phrase', voice: 'voice first sound', play: 'playback' }[k]}</span>`).join('')
  return `<!doctype html><meta charset="utf-8"><title>phoney replays</title><style>
body{font:14px -apple-system,system-ui;background:#101114;color:#eceef2;margin:0;padding:20px}a{color:#ffcc00}
td,th{padding:5px 10px;text-align:left;white-space:nowrap}th{color:#8b909a;font-size:11px;text-transform:uppercase}
td.bar{width:100%;min-width:360px}td.bar i{display:inline-block;vertical-align:top;height:18px;font:700 11px system-ui;color:#111;text-align:center;line-height:18px;font-style:normal}
.lg{display:flex;gap:14px;color:#8b909a;font-size:12px;margin:6px 0 12px}.lg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}</style>
<h1 style="font-size:20px;margin:0">phoney calls: her last word → his first sound</h1>
<p style="color:#8b909a;margin:4px 0">Median per call over her turns timed on the phone; bar = median of each step, full width = ${SCALE_MS / 1000} s.</p>
<div class="lg">${legend}</div>
<table><tr><th>call</th><th>who</th><th>device</th><th>turns</th><th>median</th><th>breakdown</th></tr>${rows}</table>`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'latest'
  const ids = readdirSync(CALLS).filter((d) => statSync(path.join(CALLS, d)).isDirectory()).sort()
  const pick = arg === 'all' ? ids : arg === 'latest' ? ids.filter((d) => /^2026\d{4}-/.test(d)).slice(-1) : [arg]
  mkdirSync(OUT, { recursive: true })
  const built: Replay[] = []
  for (const id of pick) {
    const r = build(id)
    if (!r || !r.turns.length) continue
    writeFileSync(path.join(OUT, `${id}.html`), page(r))
    writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(r, null, 1))
    built.push(r)
    const real = r.turns.filter((x) => !x.estimated && x.her)
    console.log(`${OUT}/${id}.html  ${r.turns.length} turns, ${r.clips.length} clips, median ${real.length ? median(real.map((x) => x.totalMs)) : '-'} ms`)
  }
  const all = readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) as Replay)
  writeFileSync(path.join(OUT, 'index.html'), index(all.sort((a, b) => a.id.localeCompare(b.id))))
}
