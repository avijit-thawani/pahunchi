// Speech-to-text bake-off on the user's real logged lines (logs/calls/2026*/NN_her.wav, 16 kHz mono).
//   node scripts/stt-bench.ts draft           reference drafts by a strong audio model -> gold-draft.json
//   node scripts/stt-bench.ts run [engine..]  every engine on every clip -> <engine>.json (text, ms)
//   node scripts/stt-bench.ts serve           review page at http://localhost:5198/ (fix drafts -> gold.json)
//   node scripts/stt-bench.ts score           judge each engine against gold.json -> report.md
//   DRAFT=1 node scripts/stt-bench.ts score   same against the unchecked drafts -> report-draft.md
// Paid but small (~57 clips per engine). Output: logs/stt-bench/ (gitignored).
//
// Batch engines get the whole clip, as the app sends it today; ms = request -> transcript.
// Streaming engines get the clip in 100 ms chunks at real-time pace; ms = last chunk -> final
// transcript, i.e. how long after she stops the text is ready.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, createReadStream } from 'node:fs'
import http from 'node:http'

for (const f of ['.env', '../.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const OUT = 'logs/stt-bench'
mkdirSync(OUT, { recursive: true })
const DRAFT_MODEL = 'google/gemini-4-argon'
const JUDGE_MODEL = 'google/gemini-4-argon'

type Clip = { key: string; file: string; seconds: number; appText: string }
type Result = { text: string; ms: number; error?: string }

function clips(): Clip[] {
  const out: Clip[] = []
  for (const s of readdirSync('logs/calls').filter((d) => /^2026\d{4}-/.test(d)).sort()) {
    const dir = `logs/calls/${s}`
    const events = existsSync(`${dir}/events.jsonl`)
      ? readFileSync(`${dir}/events.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    for (const f of readdirSync(dir).filter((f) => /_her\.wav$/.test(f)).sort()) {
      const turn = f.split('_')[0]
      const pcm = readFileSync(`${dir}/${f}`).length - 44
      out.push({ key: `${s}/${turn}`, file: `${dir}/${f}`, seconds: pcm / 32000, appText: events.find((e) => e.kind === 'stt' && e.turn === turn)?.text ?? '' })
    }
  }
  return process.env.LIMIT ? out.slice(0, Number(process.env.LIMIT)) : out
}

const wav = (c: Clip) => new Uint8Array(readFileSync(c.file))
const pcm = (c: Clip) => wav(c).subarray(44)
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const timed = async (fn: () => Promise<string>): Promise<Result> => {
  const t0 = Date.now()
  try { return { text: (await fn()).trim(), ms: Date.now() - t0 } } catch (e) { return { text: '', ms: Date.now() - t0, error: String(e).slice(0, 200) } }
}

async function ok(r: Response): Promise<Response> {
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`)
  return r
}

function sarvamRest(mode: string) {
  return async (c: Clip) => timed(async () => {
    const form = new FormData()
    form.append('file', new Blob([wav(c)], { type: 'audio/wav' }), 'her.wav')
    form.append('model', 'saaras:v4')
    form.append('mode', mode)
    form.append('language_code', 'hi-IN')
    const r = await ok(await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY! }, body: form }))
    return String((await r.json()).transcript ?? '')
  })
}

async function scribeRest(c: Clip): Promise<Result> {
  return timed(async () => {
    const form = new FormData()
    form.append('file', new Blob([wav(c)], { type: 'audio/wav' }), 'her.wav')
    form.append('model_id', 'scribe_v2')
    form.append('language_code', 'hi')
    form.append('tag_audio_events', 'false')
    const r = await ok(await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! }, body: form }))
    return String((await r.json()).text ?? '')
  })
}

function openrouterStt(model: string) {
  return async (c: Clip) => timed(async () => {
    const r = await ok(await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, language: 'hi', input_audio: { data: b64(wav(c)), format: 'wav' } }),
    }))
    return String((await r.json()).text ?? '')
  })
}

/** Sends 100 ms chunks at real-time pace; resolves with the final text and ms after the last chunk. */
async function stream(open: () => WebSocket, send: (ws: WebSocket, chunk: Uint8Array, last: boolean) => void,
  onMessage: (m: Record<string, unknown>) => { text?: string; final?: boolean } | undefined, c: Clip): Promise<Result> {
  const audio = pcm(c)
  const CH = 3200
  return new Promise<Result>((resolve) => {
    const ws = open()
    let lastSent = 0, text = '', done = false
    const finish = (r: Result) => { if (done) return; done = true; try { ws.close() } catch { /* closed */ } resolve(r) }
    const timer = setTimeout(() => finish({ text, ms: lastSent ? Date.now() - lastSent : -1, error: 'timeout' }), c.seconds * 1000 + 15000)
    ws.onerror = (e) => { clearTimeout(timer); finish({ text, ms: -1, error: `ws error ${String((e as ErrorEvent).message ?? '')}` }) }
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data))
      const got = onMessage(m)
      if (got?.text !== undefined) text = (got.final ? text + ' ' + got.text : text).trim()
      if (got?.final && lastSent) { clearTimeout(timer); finish({ text, ms: Date.now() - lastSent }) }
      if (m.type === 'error' || m.message_type === 'error' || /error/i.test(String(m.message_type ?? ''))) {
        clearTimeout(timer); finish({ text, ms: -1, error: JSON.stringify(m).slice(0, 200) })
      }
    }
    ws.onopen = async () => {
      for (let o = 0; o < audio.length; o += CH) {
        const last = o + CH >= audio.length
        send(ws, audio.subarray(o, o + CH), last)
        if (last) lastSent = Date.now()
        else await sleep(100)
      }
    }
  })
}

const sarvamStream = (c: Clip) => stream(
  // @ts-expect-error undici's WebSocket takes headers
  () => new WebSocket('wss://api.sarvam.ai/speech-to-text/ws?language-code=hi-IN&model=saaras:v4&mode=transcribe&sample_rate=16000&input_audio_codec=pcm_s16le&flush_signal=true', { headers: { 'Api-Subscription-Key': process.env.SARVAM_API_KEY! } }),
  (ws, chunk, last) => {
    ws.send(JSON.stringify({ audio: { data: b64(chunk), sample_rate: '16000', encoding: 'audio/wav' } }))
    if (last) ws.send(JSON.stringify({ type: 'flush' }))
  },
  (m) => (m.type === 'data' ? { text: String((m.data as { transcript?: string }).transcript ?? ''), final: true } : undefined),
  c,
)

const scribeStream = (c: Clip) => stream(
  // @ts-expect-error undici's WebSocket takes headers
  () => new WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&language_code=hi&commit_strategy=manual', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! } }),
  (ws, chunk, last) => ws.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: b64(chunk), sample_rate: 16000, commit: last })),
  (m) => (m.message_type === 'committed_transcript' ? { text: String(m.text ?? ''), final: true } : undefined),
  c,
)

const ENGINES: Record<string, { label: string; kind: 'batch' | 'stream'; run: (c: Clip) => Promise<Result> }> = {
  'sarvam': { label: 'Sarvam saaras:v4, hi-IN (today)', kind: 'batch', run: sarvamRest('transcribe') },
  'sarvam-codemix': { label: 'Sarvam saaras:v4, codemix', kind: 'batch', run: sarvamRest('codemix') },
  'sarvam-stream': { label: 'Sarvam saaras:v4 streaming', kind: 'stream', run: sarvamStream },
  'scribe': { label: 'ElevenLabs Scribe v2', kind: 'batch', run: scribeRest },
  'scribe-stream': { label: 'ElevenLabs Scribe v2 Realtime', kind: 'stream', run: scribeStream },
  'gpt-mini': { label: 'OpenAI gpt-4o-mini-transcribe', kind: 'batch', run: openrouterStt('openai/gpt-4o-mini-transcribe') },
}

const DRAFT_PROMPT = `Transcribe this phone-call audio exactly as spoken. The speaker is a young woman in India talking to a family member; she may speak Hindi, English or a mix (Hinglish).
Write Hindi words in Devanagari and English words in Latin script, as they were said (e.g. "हाँ, cab में बैठ गई"). Do not translate, do not fix grammar, keep fillers like हम्म. If a word is unclear, write your best guess.
Reply with only the transcript, or an empty line if there is no speech.`

async function draft() {
  const cs = clips()
  const out: Record<string, string> = existsSync(`${OUT}/gold-draft.json`) ? JSON.parse(readFileSync(`${OUT}/gold-draft.json`, 'utf8')) : {}
  await pool(cs.filter((c) => !(c.key in out)), 4, async (c) => {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DRAFT_MODEL, temperature: 0,
        messages: [{ role: 'user', content: [{ type: 'text', text: DRAFT_PROMPT }, { type: 'input_audio', input_audio: { data: b64(wav(c)), format: 'wav' } }] }],
      }),
    })
    const j = await r.json()
    out[c.key] = String(j.choices?.[0]?.message?.content ?? '').trim()
    if (!r.ok) console.log(c.key, JSON.stringify(j).slice(0, 200))
    else console.log(c.key, out[c.key])
  })
  writeFileSync(`${OUT}/gold-draft.json`, JSON.stringify(out, null, 1))
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]) }))
}

async function run(names: string[]) {
  const cs = clips()
  await Promise.all(names.map(async (name) => {
    const e = ENGINES[name]
    // RETRY=1 keeps earlier successes and reruns only failed clips (e.g. after a 429).
    const f = `${OUT}/${name}.json`
    const res: Record<string, Result> = process.env.RETRY && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {}
    for (const c of cs) if (!res[c.key] || res[c.key].error) res[c.key] = await e.run(c)
    writeFileSync(`${OUT}/${name}.json`, JSON.stringify(res, null, 1))
    const ok = Object.values(res).filter((r) => !r.error)
    const ms = ok.map((r) => r.ms).sort((a, b) => a - b)
    console.log(`${name.padEnd(15)} ${ok.length}/${cs.length} ok, median ${ms[Math.floor(ms.length / 2)]} ms, p90 ${ms[Math.floor(ms.length * 0.9)]} ms` +
      (ok.length < cs.length ? `  first error: ${Object.values(res).find((r) => r.error)?.error}` : ''))
  }))
}

function serve() {
  const cs = clips()
  const engines = Object.keys(ENGINES).filter((n) => existsSync(`${OUT}/${n}.json`)).map((n) => ({ n, label: ENGINES[n].label, res: JSON.parse(readFileSync(`${OUT}/${n}.json`, 'utf8')) }))
  const draft = JSON.parse(readFileSync(`${OUT}/gold-draft.json`, 'utf8'))
  const gold = existsSync(`${OUT}/gold.json`) ? JSON.parse(readFileSync(`${OUT}/gold.json`, 'utf8')) : {}
  const rows = cs.map((c, i) => ({ i: i + 1, key: c.key, src: `/audio/${c.key}`, seconds: +c.seconds.toFixed(1), text: gold[c.key]?.text ?? draft[c.key] ?? '', done: !!gold[c.key], others: engines.map((e) => [e.label, e.res[c.key]?.text ?? '']) }))
  const page = readFileSync(new URL('./stt-review.html', import.meta.url), 'utf8').replace('/*ROWS*/[]', JSON.stringify(rows).replace(/</g, '\\u003c'))
  http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x')
    if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return }
    if (url.pathname.startsWith('/audio/')) {
      const c = cs.find((x) => `/audio/${x.key}` === decodeURIComponent(url.pathname))
      if (!c) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); createReadStream(c.file).pipe(res); return
    }
    if (url.pathname === '/save' && req.method === 'POST') {
      let body = ''
      req.on('data', (d) => (body += d))
      req.on('end', () => {
        const { key, text } = JSON.parse(body)
        const g = existsSync(`${OUT}/gold.json`) ? JSON.parse(readFileSync(`${OUT}/gold.json`, 'utf8')) : {}
        g[key] = { text, at: new Date().toISOString() }
        writeFileSync(`${OUT}/gold.json`, JSON.stringify(g, null, 1))
        res.writeHead(200); res.end(String(Object.keys(g).length))
      })
      return
    }
    res.writeHead(404); res.end()
  }).listen(5198, '127.0.0.1', () => console.log(`review: http://localhost:5198/  (${cs.length} clips; saves to ${OUT}/gold.json)`))
}

const JUDGE_PROMPT = `You compare speech-to-text output with the reference transcript of one line from a phone call (Hindi/English/Hinglish).
Ignore punctuation, capitalisation, and script: "कैब" and "cab" count as the same word, as do "ओके" and "okay".
Score 2 if every word matches; 1 if a small slip that would not change how a listener replies; 0 if any meaning is lost, changed, translated into another language, or invented.
Answer as JSON: {"score": 0|1|2, "why": "<few words>"}`

async function score() {
  // DRAFT=1 scores against the unchecked drafts (provisional) until gold.json is reviewed.
  const draft = !!process.env.DRAFT
  const gold: Record<string, { text: string }> = draft
    ? Object.fromEntries(Object.entries(JSON.parse(readFileSync(`${OUT}/gold-draft.json`, 'utf8')) as Record<string, string>).map(([k, v]) => [k, { text: v }]))
    : JSON.parse(readFileSync(`${OUT}/gold.json`, 'utf8'))
  const judgeFile = `${OUT}/judge${draft ? '-draft' : ''}.json`
  const cs = clips().filter((c) => c.key in gold)
  const cache: Record<string, { score: number; why: string }> = existsSync(judgeFile) ? JSON.parse(readFileSync(judgeFile, 'utf8')) : {}
  const lines: string[] = [`# STT bake-off, ${cs.length} lines, ${draft ? 'PROVISIONAL: against unchecked drafts by ' + DRAFT_MODEL : 'against checked transcripts'}`, '', '| Engine | Kind | Score (of 2) | Exact (2) | Wrong (0) | Median ms | p90 ms |', '|---|---|---|---|---|---|---|']
  const per: string[] = []
  for (const [name, e] of Object.entries(ENGINES)) {
    if (!existsSync(`${OUT}/${name}.json`)) continue
    const res: Record<string, Result> = JSON.parse(readFileSync(`${OUT}/${name}.json`, 'utf8'))
    const jobs = cs.filter((c) => res[c.key] && !(`${name}|${c.key}` in cache))
    await pool(jobs, 6, async (c) => {
      const ref = gold[c.key].text, hyp = res[c.key].text
      if (!ref.trim() && !hyp.trim()) { cache[`${name}|${c.key}`] = { score: 2, why: 'both empty' }; return }
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: JUDGE_MODEL, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: JUDGE_PROMPT }, { role: 'user', content: `Reference: ${ref}\nOutput: ${hyp}` }] }),
      })
      const j = await r.json()
      try { cache[`${name}|${c.key}`] = JSON.parse(String(j.choices[0].message.content).replace(/^```json|```$/g, '')) } catch { /* retried next run */ }
    })
    writeFileSync(judgeFile, JSON.stringify(cache, null, 1))
    const sc = cs.map((c) => cache[`${name}|${c.key}`]?.score).filter((x): x is number => x !== undefined)
    const ms = cs.map((c) => res[c.key]).filter((r) => r && !r.error).map((r) => r.ms).sort((a, b) => a - b)
    lines.push(`| ${e.label} | ${e.kind} | ${(sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(2)} | ${sc.filter((x) => x === 2).length} | ${sc.filter((x) => x === 0).length} | ${ms[Math.floor(ms.length / 2)]} | ${ms[Math.floor(ms.length * 0.9)]} |`)
    for (const c of cs) {
      const j = cache[`${name}|${c.key}`]
      if (j?.score === 0) per.push(`- ${name} ${c.key}: "${res[c.key].text}" vs "${gold[c.key].text}" (${j.why})`)
    }
  }
  lines.push('', 'Batch ms = request -> transcript (sent after she stops). Streaming ms = last audio chunk -> final transcript.', '', '## Lines scored 0', '', ...per)
  writeFileSync(`${OUT}/report${draft ? '-draft' : ''}.md`, lines.join('\n'))
  console.log(lines.slice(0, 12).join('\n'))
}

const [cmd, ...rest] = process.argv.slice(2)
if (cmd === 'draft') await draft()
else if (cmd === 'run') await run(rest.length ? rest : Object.keys(ENGINES))
else if (cmd === 'serve') serve()
else if (cmd === 'score') await score()
else console.log('usage: stt-bench.ts draft | run [engine..] | serve | score')
