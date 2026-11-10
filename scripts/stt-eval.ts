// Fuller STT evaluation on the 57 real lines, on top of scripts/stt-bench.ts.
//   node scripts/stt-eval.ts lat [rounds]   more timing rounds per engine -> lat/<engine>.r<N>.json
//   node scripts/stt-eval.ts refs           4 audio LLMs transcribe each line -> refs/<model>.json
//   node scripts/stt-eval.ts referee        2 audio LLMs pick the reference from those -> referee/<model>.json
//   node scripts/stt-eval.ts judge          3 text LLMs score each engine vs the reference -> judges/<model>.json
//   node scripts/stt-eval.ts report         stats + script-neutral CER + cost -> report2.md, stats.json
//   node scripts/stt-eval.ts calib          judges vs the user's own scores (review page, section 1)
//   uv run --with matplotlib scripts/stt-chart.py   charts from stats.json
// The user's checked transcripts (gold.json, from `stt-bench.ts serve`) override the referee's.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { ENGINES, OUT, b64, clips, openrouterCost, pool, wav, type Clip, type Result } from './stt-bench.ts'

// openai/gpt-audio was dropped: it refused ("I can't help with that") or invented whole conversations.
const AUDIO_MODELS = ['google/gemini-4-argon', 'google/gemini-3.1-pro-preview', 'xiaomi/mimo-v2.6-pro', 'qwen/qwen3.8-omni-flash']
// gemini-3.1-pro-preview timed out on 14 of 57 lines (60 s), so the second referee is MiMo (another lab).
const REFEREES = ['google/gemini-4-argon', 'xiaomi/mimo-v2.6-pro']
// Claude Sonnet 5.5 dropped 2026-11-10: matched the user's own scores least (4/9 vs 7/9 Argon, 6/9 Sol).
const JUDGES = ['google/gemini-4-argon', 'openai/gpt-6.1-sol']
const INR_PER_USD = 85
/** List prices per audio minute (USD), 2026-11-07; Sarvam is ₹0.49/min pay-as-you-go for every mode. */
const PRICE_PER_MIN: Record<string, number> = {
  'sarvam': 0.49 / INR_PER_USD, 'sarvam-codemix': 0.49 / INR_PER_USD, 'sarvam-stream': 0.49 / INR_PER_USD,
  'scribe': 0.22 / 60, 'scribe-stream': 0.39 / 60,
}
const file = (name: string) => name.replace(/\//g, '_')
for (const d of ['lat', 'refs', 'referee', 'judges']) mkdirSync(`${OUT}/${d}`, { recursive: true })
const load = <T>(f: string, d: T): T => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d)

async function chat(model: string, content: unknown, system?: string, json = false): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let r: Response
    try {
      r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0, ...(json ? { response_format: { type: 'json_object' } } : {}),
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }],
      }),
      })
    } catch { continue }
    const j = await r.json()
    const text = j.choices?.[0]?.message?.content
    if (typeof text === 'string') return text.trim()
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)))
  }
  throw new Error(`${model}: no answer`)
}

// ---------- latency rounds ----------
async function lat(rounds: number) {
  const cs = clips()
  const sarvam = Object.keys(ENGINES).filter((n) => n.startsWith('sarvam'))
  const others = Object.keys(ENGINES).filter((n) => !n.startsWith('sarvam'))
  const runEngine = async (name: string, r: number) => {
    const f = `${OUT}/lat/${name}.r${r}.json`
    const res: Record<string, Result> = load(f, {})
    // Shuffled order per round so a slow minute doesn't always hit the same clips.
    const order = [...cs].sort(() => Math.random() - 0.5)
    for (const c of order) {
      if (res[c.key] && !res[c.key].error) continue
      res[c.key] = await ENGINES[name].run(c)
      await new Promise((ok) => setTimeout(ok, 250))
    }
    writeFileSync(f, JSON.stringify(res, null, 1))
    const ok = Object.values(res).filter((x) => !x.error).length
    console.log(`round ${r} ${name}: ${ok}/${cs.length}`)
  }
  for (let r = 2; r < 2 + rounds; r++) {
    // Sarvam's three modes share one rate limit (60 req/min), so they run one after another.
    await Promise.all([(async () => { for (const n of sarvam) await runEngine(n, r) })(), ...others.map((n) => runEngine(n, r))])
  }
  writeFileSync(`${OUT}/lat/openrouter-cost.json`, JSON.stringify(openrouterCost, null, 1))
}

// ---------- references ----------
const TRANSCRIBE = `Transcribe this phone-call audio exactly as spoken. The speaker is a young woman in India talking to a family member; she may speak Hindi, English or a mix (Hinglish).
Write Hindi words in Devanagari and English words in Latin script, as said (e.g. "हाँ, cab में बैठ गई"). Do not translate, do not fix grammar, keep fillers like हम्म. If a word is unclear, give your best guess.
Reply with only the transcript, or an empty line if there is no speech.`

async function refs() {
  const cs = clips()
  await Promise.all(AUDIO_MODELS.map(async (m) => {
    const f = `${OUT}/refs/${file(m)}.json`
    const out: Record<string, string> = load(f, {})
    await pool(cs.filter((c) => !(c.key in out)), 3, async (c) => {
      try { out[c.key] = await chat(m, [{ type: 'text', text: TRANSCRIBE }, { type: 'input_audio', input_audio: { data: b64(wav(c)), format: 'wav' } }]) } catch (e) { console.log(m, c.key, String(e)) }
    })
    writeFileSync(f, JSON.stringify(out, null, 1))
    console.log(`${m}: ${Object.keys(out).length}/${cs.length}`)
  }))
}

const REFEREE = `You are making the reference transcript of one line from a phone call (a young woman in India; Hindi, English or Hinglish). You get the audio and several transcripts by other systems, which may be wrong.
Listen to the audio and write what was actually said. Hindi words in Devanagari, English words in Latin script, as said; no translation; keep fillers.
Answer as JSON: {"transcript": "...", "confidence": "high" | "medium" | "low", "note": "<few words on what was hard, or empty>"}`

async function referee() {
  const cs = clips()
  const cands = AUDIO_MODELS.map((m) => load<Record<string, string>>(`${OUT}/refs/${file(m)}.json`, {}))
  await Promise.all(REFEREES.map(async (m) => {
    const f = `${OUT}/referee/${file(m)}.json`
    const out: Record<string, { transcript: string; confidence: string; note: string }> = load(f, {})
    await pool(cs.filter((c) => !(c.key in out)), 3, async (c) => {
      const list = cands.map((x, i) => `${String.fromCharCode(65 + i)}: ${x[c.key] ?? ''}`).join('\n')
      try {
        const raw = await chat(m, [{ type: 'text', text: `Transcripts by other systems:\n${list}` }, { type: 'input_audio', input_audio: { data: b64(wav(c)), format: 'wav' } }], REFEREE, true)
        out[c.key] = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw)
      } catch (e) { console.log(m, c.key, String(e)) }
    })
    writeFileSync(f, JSON.stringify(out, null, 1))
    console.log(`${m}: ${Object.keys(out).length}/${cs.length}`)
  }))
}

// ---------- script-neutral CER ----------
const translitCache: Record<string, string> = load(`${OUT}/translit.json`, {})
async function deva(s: string): Promise<string> {
  if (!s.trim()) return ''
  if (!/[A-Za-z]/.test(s)) return s
  if (s in translitCache) return translitCache[s]
  const r = await fetch('https://api.sarvam.ai/transliterate', {
    method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: s.slice(0, 1000), source_language_code: 'en-IN', target_language_code: 'hi-IN' }),
  })
  const j = await r.json()
  translitCache[s] = String(j.transliterated_text ?? s)
  return translitCache[s]
}
/** Devanagari only, no punctuation, ँ->ं (हाँ/हां), single spaces. */
const norm = (s: string) => s.normalize('NFC').replace(/ँ/g, 'ं').replace(/[^\u0900-\u097F\s0-9]/g, ' ').replace(/[।॥]/g, ' ').replace(/\s+/g, ' ').trim()
function lev(a: string, b: string): number {
  const A = [...a], B = [...b]
  let prev = Array.from({ length: B.length + 1 }, (_, i) => i)
  for (let i = 1; i <= A.length; i++) {
    const cur = [i]
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[B.length]
}
async function cer(ref: string, hyp: string): Promise<number> {
  const r = norm(await deva(ref)), h = norm(await deva(hyp))
  if (!r) return h ? 1 : 0
  return Math.min(1, lev(r, h) / [...r].length)
}

// ---------- reference used for scoring ----------
type Ref = { text: string; source: 'user' | 'referees agree' | 'referees disagree'; confidence?: string }
async function references(): Promise<Record<string, Ref>> {
  const gold = load<Record<string, { text: string }>>(`${OUT}/gold.json`, {})
  const [a, b] = REFEREES.map((m) => load<Record<string, { transcript: string; confidence: string }>>(`${OUT}/referee/${file(m)}.json`, {}))
  const out: Record<string, Ref> = {}
  for (const c of clips()) {
    if (gold[c.key]) { out[c.key] = { text: gold[c.key].text, source: 'user' }; continue }
    const x = a[c.key]?.transcript ?? '', y = b[c.key]?.transcript ?? ''
    const agree = (await cer(x, y)) <= 0.15 && (await cer(y, x)) <= 0.15
    out[c.key] = { text: x, source: agree ? 'referees agree' : 'referees disagree', confidence: a[c.key]?.confidence }
  }
  return out
}

// ---------- judges ----------
const JUDGE = `You compare a speech-to-text output with the reference transcript of one line from a phone call (Hindi/English/Hinglish).
Ignore punctuation, capitalisation and script: "कैब" and "cab" are the same word, as are "ओके" and "okay".
Score 2 if every word matches; 1 if small slips that would not change how a listener replies; 0 if meaning is lost, changed, translated into another language, or invented.
Answer as JSON: {"score": 0|1|2, "why": "<few words>"}`

async function judge() {
  const refsBy = await references()
  const cs = clips()
  const hyps = Object.keys(ENGINES).filter((n) => existsSync(`${OUT}/${n}.json`)).map((n) => [n, load<Record<string, Result>>(`${OUT}/${n}.json`, {})] as const)
  await Promise.all(JUDGES.map(async (m) => {
    const f = `${OUT}/judges/${file(m)}.json`
    const out: Record<string, { score: number; why: string; ref: string }> = load(f, {})
    const jobs: [string, Clip, string][] = []
    for (const [n, res] of hyps) for (const c of cs) {
      const k = `${n}|${c.key}`
      if (!out[k] || out[k].ref !== refsBy[c.key].text) jobs.push([n, c, res[c.key]?.text ?? ''])
    }
    await pool(jobs, 6, async ([n, c, hyp]) => {
      const ref = refsBy[c.key].text
      if (!ref.trim() && !hyp.trim()) { out[`${n}|${c.key}`] = { score: 2, why: 'both empty', ref }; return }
      try {
        const raw = await chat(m, `Reference: ${ref}\nOutput: ${hyp}`, JUDGE, true)
        out[`${n}|${c.key}`] = { ...JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? raw), ref }
      } catch (e) { console.log(m, n, c.key, String(e).slice(0, 100)) }
    })
    writeFileSync(f, JSON.stringify(out, null, 1))
    console.log(`${m}: ${Object.keys(out).length} judgements`)
  }))
}

// ---------- report ----------
const q = (xs: number[], p: number) => { const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))] }
/** 95% CI of stat by resampling clips (all of a clip's samples move together). */
function boot(groups: number[][], stat: (xs: number[]) => number, n = 2000): [number, number] {
  const vals: number[] = []
  for (let i = 0; i < n; i++) {
    const xs: number[] = []
    for (let j = 0; j < groups.length; j++) xs.push(...groups[Math.floor(Math.random() * groups.length)])
    if (xs.length) vals.push(stat(xs))
  }
  return [q(vals, 0.025), q(vals, 0.975)]
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const r0 = (x: number) => Math.round(x)

async function report() {
  const cs = clips()
  const refsBy = await references()
  const judgeData = JUDGES.map((m) => load<Record<string, { score: number }>>(`${OUT}/judges/${file(m)}.json`, {}))
  const orCost = load<Record<string, { usd: number; seconds: number }>>(`${OUT}/lat/openrouter-cost.json`, {})
  const minutes = cs.reduce((a, c) => a + c.seconds, 0) / 60
  const stats: Record<string, unknown>[] = []
  const lines = [
    `# STT evaluation, ${cs.length} real lines (${minutes.toFixed(1)} min of her speech), ${new Date().toISOString().slice(0, 10)}`, '',
    `Reference per line: the user's check where done, else two audio referees (${REFEREES.join(', ')}) choosing among ${AUDIO_MODELS.length} audio-LLM transcripts. ` +
    `Lines: ${Object.values(refsBy).filter((r) => r.source === 'user').length} user-checked, ${Object.values(refsBy).filter((r) => r.source === 'referees agree').length} referees agree, ${Object.values(refsBy).filter((r) => r.source === 'referees disagree').length} disagree.`,
    `Judges: ${JUDGES.join(', ')}. CER = character error rate after writing both in Devanagari (Sarvam transliteration), so script choice doesn't count. 95% CIs by resampling lines.`, '',
    '| Engine | Kind | Ready after she stops p50 (95% CI) | p90 (95% CI) | Judge score /2 (95% CI) | Same, sure lines only | Wrong (0) | CER (95% CI) | Judges agree | $/min audio |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const [name, e] of Object.entries(ENGINES)) {
    const rounds = [`${OUT}/${name}.json`, ...[2, 3, 4, 5, 6].map((r) => `${OUT}/lat/${name}.r${r}.json`)].filter(existsSync).map((f) => load<Record<string, Result>>(f, {}))
    if (!rounds.length) continue
    const latGroups = cs.map((c) => rounds.map((r) => r[c.key]).filter((x) => x && !x.error && x.ms >= 0).map((x) => x.ms)).filter((g) => g.length)
    const allLat = latGroups.flat()
    const first = rounds[0]
    const perClip = cs.map((c) => {
      const sc = judgeData.map((j) => j[`${name}|${c.key}`]?.score).filter((x): x is number => x !== undefined)
      return { c, sc }
    }).filter((x) => x.sc.length)
    const scoreGroups = perClip.map((x) => [mean(x.sc)])
    const sure = perClip.filter((x) => refsBy[x.c.key].source !== 'referees disagree').map((x) => [mean(x.sc)])
    const agree = perClip.filter((x) => x.sc.length === JUDGES.length && x.sc.every((s) => s === x.sc[0])).length
    const wrong = perClip.filter((x) => mean(x.sc) < 0.5).length
    const cers: number[][] = []
    for (const c of cs) cers.push([await cer(refsBy[c.key].text, first[c.key]?.text ?? '')])
    const price = PRICE_PER_MIN[name] ?? (orCost['openai/gpt-4o-mini-transcribe']?.seconds ? orCost['openai/gpt-4o-mini-transcribe'].usd / (orCost['openai/gpt-4o-mini-transcribe'].seconds / 60) : NaN)
    const s = {
      name, label: e.label, kind: e.kind, samples: allLat.length,
      p50: q(allLat, 0.5), p50ci: boot(latGroups, (xs) => q(xs, 0.5)), p90: q(allLat, 0.9), p90ci: boot(latGroups, (xs) => q(xs, 0.9)),
      score: mean(scoreGroups.flat()), scoreci: boot(scoreGroups, mean), sure: mean(sure.flat()), sureci: boot(sure, mean), sureN: sure.length, wrong, agree, judged: perClip.length,
      cer: mean(cers.flat()), cerci: boot(cers, mean), usdPerMin: price,
    }
    stats.push(s)
    lines.push(`| ${e.label} | ${e.kind} | ${r0(s.p50)} ms (${r0(s.p50ci[0])}-${r0(s.p50ci[1])}) | ${r0(s.p90)} ms (${r0(s.p90ci[0])}-${r0(s.p90ci[1])}) | ` +
      `${s.score.toFixed(2)} (${s.scoreci[0].toFixed(2)}-${s.scoreci[1].toFixed(2)}) | ${s.sure.toFixed(2)} (${s.sureci[0].toFixed(2)}-${s.sureci[1].toFixed(2)}, ${s.sureN} lines) | ${wrong}/${perClip.length} | ${(100 * s.cer).toFixed(0)}% (${(100 * s.cerci[0]).toFixed(0)}-${(100 * s.cerci[1]).toFixed(0)}) | ` +
      `${Math.round((100 * agree) / Math.max(1, perClip.length))}% | ${price ? '$' + price.toFixed(4) : '?'} |`)
  }
  lines.push('', `Latency: ${'batch = request -> transcript, sent when she stops; streaming = last 100 ms chunk (sent in real time) -> final transcript'}. Samples per engine = rounds x lines (no-speech lines excluded for streaming).`)
  lines.push('Cost: list prices per minute of audio sent; streaming billed for every second the connection carries audio.')
  const disputed = cs.filter((c) => refsBy[c.key].source === 'referees disagree')
  if (disputed.length) lines.push('', '## Lines where the referees disagree (check these first)', '', ...disputed.map((c) => `- ${c.key}: "${refsBy[c.key].text}"`))
  writeFileSync(`${OUT}/report2.md`, lines.join('\n'))
  writeFileSync(`${OUT}/stats.json`, JSON.stringify(stats, null, 1))
  writeFileSync(`${OUT}/translit.json`, JSON.stringify(translitCache, null, 1))
  console.log(lines.join('\n'))
}

/** Judges vs the user's own scores on the review page's calibration examples, per language. */
function calib() {
  const cal = load<Record<string, { lang: string; user: number | null; judges: { name: string; score: number }[] }>>(`${OUT}/calibration.json`, {})
  const rows = Object.values(cal).filter((x) => x.user !== null)
  if (!rows.length) { console.log('no scored examples yet (review page, section 1)'); return }
  const names = rows[0].judges.map((j) => j.name)
  console.log(`${rows.length} examples scored by the user (${Object.values(cal).length - rows.length} marked "reference unsure")\n`)
  console.log('judge'.padEnd(22) + ['all', 'Hindi', 'Hinglish', 'English'].map((l) => l.padEnd(20)).join('') + 'bias')
  for (const n of [...names, 'majority']) {
    const cell = (lang: string) => {
      const rs = rows.filter((r) => lang === 'all' || r.lang === lang)
      if (!rs.length) return '-'
      const js = rs.map((r) => n === 'majority' ? [...r.judges.map((j) => j.score)].sort()[1] : r.judges.find((j) => j.name === n)!.score)
      const exact = rs.filter((r, i) => js[i] === r.user).length
      return `${exact}/${rs.length} exact`
    }
    const bias = mean(rows.map((r) => (n === 'majority' ? [...r.judges.map((j) => j.score)].sort()[1] : r.judges.find((j) => j.name === n)!.score) - r.user!))
    console.log(n.padEnd(22) + ['all', 'Hindi', 'Hinglish', 'English'].map((l) => cell(l).padEnd(20)).join('') + `${bias >= 0 ? '+' : ''}${bias.toFixed(2)} (judge - you)`)
  }
}

const [cmd, arg] = process.argv.slice(2)
if (cmd === 'calib') calib()
else if (cmd === 'lat') await lat(Number(arg) || 3)
else if (cmd === 'refs') await refs()
else if (cmd === 'referee') await referee()
else if (cmd === 'judge') await judge()
else if (cmd === 'report') await report()
else console.log('usage: stt-eval.ts lat [rounds] | refs | referee | judge | report | calib')
