// Replays logged calls as pages: the call's real audio on one timeline (user lines, ai clauses,
// fillers) and, per turn, the user's last word -> the ai's first sound split by pipeline step.
//   node scripts/replay.ts serve                  builds every call, serves http://localhost:5199/ (calls grouped by user; click one, Replay)
//   thumbs on a call page (STT / LLM / TTS per turn) save at once to logs/replay/ratings.json while `serve` runs
//   node scripts/replay.ts name <id> <name>       names every call from that call's device (kept in logs/, not git)
//   node scripts/replay.ts [<id>|latest|all]      -> logs/replay/<id>.html (+ index.html)
//   node scripts/replay-shot.mjs <id> [--video]   -> PNG (and MP4 with the call audio)
// Deployed calls: `node scripts/logs.ts --remote <id>` downloads one into logs/calls/ first.
//
// Steps come from the phone's per-turn metrics (store.ts TurnMetrics), so they add up to the delay the user
// heard. The server's own share of each step (from events.jsonl) is drawn solid, the rest
// (upload, network, decode) hatched. Turns without phone metrics (the call ended before the ai
// finished) use server timings plus the pause wait, drawn dashed and marked "~".

import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const CALLS = 'logs/calls'
const OUT = 'logs/replay'
const END_MS = 600
const NET_GUESS_MS = 150

type Ev = { at: string; kind: string; turn?: string; text?: string; ms?: number; firstClauseMs?: number; firstByteMs?: number; seconds?: number; [k: string]: unknown }
type Metrics = { turn?: string; speechMs?: number; vadMs?: number; sttMs?: number; llmMs?: number; replyMs?: number; ttsFirstByteMs?: number; totalMs?: number; speculative?: boolean }
/** `llm` runs to the whole reply; `gate` = ms until its first phrase, where `tts` starts. */
type Step = { key: 'wait' | 'stt' | 'llm' | 'tts' | 'play'; from: number; to: number; server?: number; gate?: number }
/** `dropped`: generated on the server but never played on the phone (a newer turn replaced it). */
type Clip = { who: 'user' | 'ai' | 'filler'; src: string; start: number; dur: number; text?: string; turn?: string; dropped?: boolean }
type Turn = { turn: string; user?: string; ai: string; userEnd: number; speechMs?: number; totalMs: number; estimated: boolean; speculative?: boolean; steps: Step[]
  /** The phone plays ai audio through one queue: `heardMs` = user's last word -> audible, when it waited behind turn `behind`. */
  dropped?: boolean; heardMs?: number; behind?: string }
export type Replay = {
  id: string; persona: string; name: string; language: string; voice?: string; device?: string
  durationS: number; clips: Clip[]; turns: Turn[]
  /** For the index: when it started (UTC), the caller's UTC offset, screen size, hang-up time. */
  startedAt?: string; tzMin?: number; timeZone?: string; screen?: string; callS?: number; script?: boolean
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
  const test = /Headless|Cursor\//.test(ua) ? ' (test browser)' : ''
  if (/Android/.test(ua)) {
    // Chrome hides the model ("K"); the app's WebView reports it.
    const model = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|[;)])/)?.[1]
    return (/wv\)/.test(ua) ? 'Android app' : 'Android browser') + (model && model !== 'K' ? `, ${model}` : '')
  }
  if (/iPhone|iPad/.test(ua)) return 'iPhone'
  if (/Macintosh/.test(ua)) return 'Mac' + test
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux' + test
  return ua.split('/')[0].slice(0, 30)
}

/** Session ids start with the caller's local time, so id time - UTC start = their UTC offset (minutes). */
function tzOffset(id: string, startedAt?: string): number | undefined {
  const m = id.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-/)
  if (!m || !startedAt) return undefined
  const [y, mo, d, h, mi, sec] = m.slice(1).map(Number)
  return Math.round((Date.UTC(y, mo - 1, d, h, mi, sec) - t(startedAt)) / 900000) * 15
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
      vad = m.vadMs ?? 0
      total = m.totalMs
      const ai = m.llmMs ?? reply.firstClauseMs ?? 0
      const voice = m.ttsFirstByteMs ?? first?.firstByteMs ?? 0
      const sttSpan = Math.max(stt.ms ?? 0, total - vad - ai - voice)
      const llm0 = vad + sttSpan
      steps = [
        { key: 'wait', from: 0, to: vad },
        { key: 'stt', from: vad, to: llm0, server: stt.ms },
        { key: 'llm', from: llm0, to: llm0 + Math.max(ai, m.replyMs ?? reply.ms ?? ai), server: reply.ms, gate: ai },
        { key: 'tts', from: llm0 + ai, to: llm0 + ai + voice, server: first?.firstByteMs },
      ]
      const used = llm0 + ai + voice
      if (total > used + 20) steps.push({ key: 'play', from: used, to: total })
    } else {
      estimated = true
      vad = stt ? END_MS : 0
      const s = stt ? (stt.ms ?? 0) + NET_GUESS_MS : 0
      const ai = (reply.firstClauseMs ?? 0) + NET_GUESS_MS
      const voice = (first?.firstByteMs ?? 0) + NET_GUESS_MS
      const llm0 = vad + s
      steps = [
        ...(stt ? [{ key: 'wait', from: 0, to: vad } as Step, { key: 'stt', from: vad, to: llm0, server: stt.ms } as Step] : []),
        { key: 'llm', from: llm0, to: llm0 + Math.max(ai, (reply.ms ?? 0) + NET_GUESS_MS), server: reply.ms, gate: ai },
        { key: 'tts', from: llm0 + ai, to: llm0 + ai + voice, server: first?.firstByteMs },
      ]
      total = llm0 + ai + voice
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
      clips.push({ who: 'user', src: src(herFile), start: (herEnd + vad) / 1000 - dur, dur, text: stt?.text, turn: label })
    }
    // Clause files are named when their audio started arriving, not in spoken order.
    const used = new Set<Ev>()
    const him = himFiles.map((f) => {
      const dur = wavSeconds(path.join(dir, f))
      const ev = tts.find((e) => !used.has(e) && Math.abs((e.seconds ?? 0) - dur) < 0.05)
      if (ev) used.add(ev)
      const pos = ev ? replyText.indexOf(String(ev.text)) : -1
      return { f, dur, text: ev?.text, pos: pos < 0 ? Infinity : pos }
    }).sort((a, b) => a.pos - b.pos)
    let at = (herEnd + total) / 1000
    for (const h of him) {
      clips.push({ who: 'ai', src: src(h.f), start: at, dur: h.dur, text: h.text, turn: label })
      at += h.dur
    }
    turns.push({
      turn: label, user: stt?.text, ai: replyText, userEnd: herEnd / 1000, speechMs: m?.speechMs,
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

  // A reply the phone never finished queueing is missing from its transcript. If a later turn did play, that
  // turn replaced it before its audio arrived (call.ts bumps `gen`); the server still logged its TTS.
  const said: Set<string> | undefined = end?.turns && new Set(end.turns.filter((x: { who: string }) => x.who === 'them').map((x: { text: string }) => x.text))
  if (said) turns.forEach((x, i) => {
    if (x.estimated && x.user && !said.has(x.ai) && turns.slice(i + 1).some((y) => !y.estimated || said.has(y.ai))) x.dropped = true
  })
  const droppedTurns = new Set(turns.filter((x) => x.dropped).map((x) => x.turn))
  for (const c of clips) if (c.who === 'ai' && droppedTurns.has(c.turn!)) c.dropped = true
  // The phone has one playhead (audio.ts schedule): a clip that arrives while another is playing waits its turn.
  // Its logged delay is when it was queued, so add the wait to get when the user heard it.
  let playhead = 0, last: string | undefined
  for (const c of clips.filter((x) => x.who !== 'user' && !x.dropped).sort((a, b) => a.start - b.start)) {
    const wait = playhead - c.start
    if (wait > 0.05) {
      const turn = turns.find((x) => x.turn === c.turn)
      // Only claim it where both sides are solid: this turn timed on the phone, and not behind the opener (whose start is a guess).
      if (turn && !turn.estimated && turn.heardMs == null && wait > 0.3 && last && last !== `turn ${c.turn}` && last !== 'turn 00') {
        turn.heardMs = Math.round(turn.totalMs + wait * 1000); turn.behind = last
      }
      c.start = playhead
    }
    playhead = c.start + c.dur
    last = c.who === 'filler' ? 'the filler' : `turn ${c.turn}`
  }

  const lastEv = Math.max(...events.map((e) => t(e.at)))
  const startedAt: string | undefined = start?.startedAt ?? end?.startedAt
  const durationS = Math.max((lastEv - t0) / 1000, ...clips.map((c) => c.start + c.dur)) + 0.5
  return {
    id, persona: end?.personaId ?? start?.personaId ?? '?', name: end?.name ?? start?.name ?? '', language: end?.language ?? start?.language ?? '',
    voice: end?.voiceId ?? start?.voiceId, device: device(start?.userAgent ?? end?.userAgent), durationS: +durationS.toFixed(2),
    clips: clips.sort((a, b) => a.start - b.start), turns,
    startedAt: startedAt ?? new Date(t0).toISOString(), tzMin: tzOffset(id, startedAt), timeZone: start?.timeZone, screen: start?.screen ?? end?.screen,
    callS: end?.durationS, script: !startedAt,
  }
}

const TEMPLATE = readFileSync(new URL('./replay.html', import.meta.url), 'utf8')

function page(r: Replay, user?: string): string {
  return TEMPLATE.replace('/*DATA*/null', () => JSON.stringify({ ...r, user }).replace(/</g, '\\u003c')).replace('<title>phoney replay</title>', `<title>${r.id} replay</title>`)
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN)

const SCRIPTS = 'test scripts'
const INDEX = readFileSync(new URL('./replay-index.html', import.meta.url), 'utf8')

// Made-up names for callers we can't name, like experiment trackers do: stable per caller.
const ADJ = ['amber', 'brisk', 'calm', 'dusky', 'eager', 'fuzzy', 'gentle', 'hazy', 'ivory', 'jolly', 'keen', 'lively', 'mellow', 'nimble', 'olive', 'plucky', 'quiet', 'rosy', 'sunny', 'tidy', 'umber', 'vivid', 'witty', 'zesty']
const NOUN = ['banyan', 'chai', 'dhow', 'egret', 'ferry', 'gulmohar', 'heron', 'jamun', 'kite', 'lotus', 'mango', 'neem', 'otter', 'peacock', 'quail', 'rickshaw', 'sparrow', 'tamarind', 'tulsi', 'veena', 'wagtail', 'yak']
function nickname(key: string, taken: Set<string>): string {
  let h = 2166136261
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0 // similar keys differ only in their last characters: mix
  // No adjective or noun repeats until the list runs out, so names are easy to tell apart.
  const pick = (words: string[], from: number) => {
    for (let i = 0; i < words.length; i++) {
      const w = words[(from + i) % words.length]
      if (!taken.has(w)) { taken.add(w); return w }
    }
    return words[from % words.length]
  }
  return `${pick(ADJ, h % ADJ.length)}-${pick(NOUN, (h >>> 8) % NOUN.length)}`
}

const NAMES = path.join(OUT, 'names.json')
const RATINGS = path.join(OUT, 'ratings.json') // thumbs from the call pages: { <call id>: { <turn>: { stt|llm|tts: 1 | -1 } } }
const SIDE_FILES = ['accounts.json', 'names.json', 'ratings.json']
const fingerprint = (r: Replay) => `${r.device}|${r.screen}|${r.tzMin}`

function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name]
  for (const f of ['.env', '../.env']) {
    const m = existsSync(f) && readFileSync(f, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))
    if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '')
  }
}

/** Call id -> account name, for calls made while signed in (they are mirrored to `calls`). Cached in logs/replay/. */
async function accounts(): Promise<Record<string, string>> {
  const cache = path.join(OUT, 'accounts.json')
  const url = env('SUPABASE_URL'), key = env('SUPABASE_SERVICE_ROLE_KEY')
  try {
    if (!url || !key) throw new Error('no Supabase keys')
    const get = async (p: string) => {
      const r = await fetch(url + p, { headers: { Authorization: `Bearer ${key}`, apikey: key }, signal: AbortSignal.timeout(6000) })
      if (!r.ok) throw new Error(`${p} ${r.status}`)
      return r.json()
    }
    const calls: { id: string; owner_id: string }[] = await get('/rest/v1/calls?select=id,owner_id')
    const users: { id: string; email?: string; user_metadata?: { full_name?: string; name?: string } }[] = (await get('/auth/v1/admin/users?per_page=1000')).users ?? []
    const names = new Map(users.map((u) => [u.id, u.user_metadata?.full_name || u.user_metadata?.name || u.email || u.id.slice(0, 8)]))
    const out = Object.fromEntries(calls.map((c) => [c.id, names.get(c.owner_id) ?? c.owner_id.slice(0, 8)]))
    writeFileSync(cache, JSON.stringify(out))
    return out
  } catch (e) {
    const cached = json(cache)
    console.log(`account names: ${cached ? 'using cache' : 'none'} (${String(e).slice(0, 80)})`)
    return cached ?? {}
  }
}

/** Who made each call: the signed-in account, else a name given with `replay.ts name`, else a nickname for the device. */
function callers(rs: Replay[], account: Record<string, string>): Map<string, string> {
  const taken = new Set<string>(), nick = new Map<string, string>()
  const named: Record<string, string> = json(NAMES) ?? {}
  return new Map([...rs].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '')).map((r) => {
    const key = fingerprint(r)
    if (r.script) return [r.id, SCRIPTS]
    // Every device gets its nickname even when a real name hides it, so naming one caller never renames the others.
    const made = nick.get(key) ?? nick.set(key, nickname(key, taken)).get(key)!
    return [r.id, account[r.id] ?? named[key] ?? made] // a signed-in call is that account's, whatever the device was named
  }))
}

function index(rs: Replay[], who: Map<string, string>): string {
  const rows = [...rs].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '')).map((r) => {
    const real = r.turns.filter((x) => !x.estimated && x.user)
    const totals = real.map((x) => x.totalMs)
    const user = who.get(r.id)!
    return {
      id: r.id, at: Date.parse(r.startedAt ?? '') || 0, tzMin: r.tzMin, timeZone: r.timeZone, user, device: r.device ?? '', who: r.name || r.persona,
      language: r.language, lengthS: r.callS ?? r.durationS, userTurns: r.turns.filter((x) => x.user).length,
      median: totals.length ? median(totals) : null, slowest: totals.length ? Math.max(...totals) : null, totals,
      said: r.turns.find((x) => x.user)?.user ?? '',
    }
  })
  const data = { rows, scripts: SCRIPTS }
  return INDEX.replace('/*DATA*/null', () => JSON.stringify(data).replace(/</g, '\\u003c'))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2] || 'latest'
  mkdirSync(OUT, { recursive: true })
  if (arg === 'name') {
    // Stays in logs/ (gitignored): real people's names never go to git.
    const [id, ...words] = process.argv.slice(3)
    const r = id ? build(id) : undefined
    if (!r || !words.length) { console.log('usage: replay.ts name <call id> <name>   (names every call from that device)'); process.exit(1) }
    writeFileSync(NAMES, JSON.stringify({ ...(json(NAMES) ?? {}), [fingerprint(r)]: words.join(' ') }, null, 1))
    console.log(`${fingerprint(r)} -> ${words.join(' ')}`)
  }
  const ids = readdirSync(CALLS).filter((d) => statSync(path.join(CALLS, d)).isDirectory()).sort()
  const pick = arg === 'all' || arg === 'serve' || arg === 'name' ? ids : arg === 'latest' ? ids.filter((d) => /^2026\d{4}-/.test(d)).slice(-1) : [arg]
  mkdirSync(OUT, { recursive: true })
  const built: Replay[] = []
  for (const id of pick) {
    const r = build(id)
    if (!r || !r.turns.length) continue
    writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(r, null, 1))
    built.push(r)
    const real = r.turns.filter((x) => !x.estimated && x.user)
    console.log(`${OUT}/${id}.html  ${r.turns.length} turns, ${r.clips.length} clips, median ${real.length ? median(real.map((x) => x.totalMs)) : '-'} ms`)
  }
  const all = readdirSync(OUT).filter((f) => f.endsWith('.json') && !SIDE_FILES.includes(f)).map((f) => JSON.parse(readFileSync(path.join(OUT, f), 'utf8')) as Replay)
  const who = callers(all, await accounts())
  // Every page carries its caller's name, so pages are rewritten whenever names may have changed.
  for (const r of all) writeFileSync(path.join(OUT, `${r.id}.html`), page(r, who.get(r.id)))
  writeFileSync(path.join(OUT, 'index.html'), index(all, who))
  if (arg === 'serve') {
    const root = path.resolve('logs')
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4' }
    http.createServer((req, res) => {
      const url = decodeURIComponent(new URL(req.url!, 'http://x').pathname)
      if (req.method === 'POST' && url === '/rate') {
        // A thumb on a call page: written straight to disk so nothing is lost if the tab closes.
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          try {
            const { id, turn, step, v } = JSON.parse(body)
            if (!/^[\w-]+$/.test(id) || !/^\d+$/.test(turn) || !['stt', 'llm', 'tts'].includes(step) || ![1, 0, -1].includes(v)) throw new Error('bad rating')
            const all = json(RATINGS) ?? {}
            const t = ((all[id] ??= {})[turn] ??= {})
            if (v) t[step] = v
            else delete t[step]
            if (!Object.keys(all[id][turn]).length) delete all[id][turn]
            if (!Object.keys(all[id]).length) delete all[id]
            writeFileSync(RATINGS, JSON.stringify(all, null, 1))
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}')
          } catch (e) { res.writeHead(400); res.end(String(e)) }
        })
        return
      }
      if (url === '/') { res.writeHead(302, { Location: '/replay/' }); res.end(); return }
      const p = path.join(root, url.endsWith('/') ? url + 'index.html' : url)
      if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }) // rebuilt pages must never come from the browser's cache
      createReadStream(p).pipe(res)
    }).listen(5199, '127.0.0.1', () => console.log('replays: http://localhost:5199/'))
  }
}
