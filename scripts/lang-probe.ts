// Offline probe for kanban/auto-language.md. Paid but tiny (Sarvam STT/TTS + a few LLM replies).
//   node scripts/lang-probe.ts [ears|sticky|brain|voice|all]
// ears:   her real logged lines (logs/calls/2026*/*_her.wav) through Sarvam STT, forced hi-IN vs `unknown`
// sticky: replays each real call through the sticky-language rule on the `unknown` results
// brain:  "mirror her" prompt on the app's LLM, her line in each language -> script of his reply
// voice:  his line in each language in a Hindi voice vs a native one, round-tripped through STT
// Output: logs/lang-probe/ (gitignored).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { persona } from '../shared/personas.ts'
import { systemPrompt } from '../server/prompt.ts'
import { pcmToWav } from '../server/log.ts'

for (const f of ['.env', '../.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const SARVAM = process.env.SARVAM_API_KEY!
const OUT = 'logs/lang-probe'
mkdirSync(OUT, { recursive: true })
const LLM_MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'

const SCRIPTS: [RegExp, string][] = [
  [/[\u0900-\u097F]/g, 'hi-IN'], [/[\u0980-\u09FF]/g, 'bn-IN'], [/[\u0A00-\u0A7F]/g, 'pa-IN'],
  [/[\u0A80-\u0AFF]/g, 'gu-IN'], [/[\u0B00-\u0B7F]/g, 'od-IN'], [/[\u0B80-\u0BFF]/g, 'ta-IN'],
  [/[\u0C00-\u0C7F]/g, 'te-IN'], [/[\u0C80-\u0CFF]/g, 'kn-IN'], [/[\u0D00-\u0D7F]/g, 'ml-IN'],
]
/** TTS language from the reply's script: the Indic script with most letters, else English. */
export function scriptLanguage(text: string): string {
  let best = 'en-IN', n = 0
  for (const [re, code] of SCRIPTS) {
    const c = text.match(re)?.length ?? 0
    if (c > n) [best, n] = [code, c]
  }
  return best
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

type Stt = { text: string; lang: string | null; p: number | null; ms: number; error?: string }
async function stt(wav: Uint8Array, code: string): Promise<Stt> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'her.wav')
  form.append('model', 'saaras:v4')
  form.append('mode', 'transcribe')
  form.append('language_code', code)
  const t0 = Date.now()
  const r = await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': SARVAM }, body: form })
  const ms = Date.now() - t0
  if (!r.ok) return { text: '', lang: null, p: null, ms, error: `${r.status} ${(await r.text()).slice(0, 120)}` }
  const j = await r.json()
  return { text: String(j.transcript || '').trim(), lang: j.language_code ?? null, p: j.language_probability ?? null, ms }
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

type EarRow = { session: string; file: string; logged: string; hi: Stt; auto: Stt }
async function ears(): Promise<EarRow[]> {
  const clips: { session: string; file: string; logged: string }[] = []
  for (const s of readdirSync('logs/calls').filter((d) => /^2026\d{4}-/.test(d)).sort()) {
    const dir = `logs/calls/${s}`
    const events = existsSync(`${dir}/events.jsonl`)
      ? readFileSync(`${dir}/events.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
    for (const f of readdirSync(dir).filter((f) => /_her\.wav$/.test(f)).sort()) {
      const turn = f.split('_')[0]
      const e = events.find((x) => x.kind === 'stt' && (x.turn === turn || String(x.turn) === turn))
      clips.push({ session: s, file: f, logged: e?.text ?? '' })
    }
  }
  const rows = await pool(clips, 4, async (c) => {
    const wav = new Uint8Array(readFileSync(`logs/calls/${c.session}/${c.file}`))
    const [hi, auto] = await Promise.all([stt(wav, 'hi-IN'), stt(wav, 'unknown')])
    return { ...c, hi, auto }
  })
  writeFileSync(`${OUT}/ears.json`, JSON.stringify(rows, null, 1))
  console.log(`\n== ears: ${rows.length} real lines from ${new Set(rows.map((r) => r.session)).size} calls`)
  for (const r of rows) {
    console.log(`${r.session.slice(9, 15)} ${r.auto.lang ?? '-'} p=${r.auto.p?.toFixed(2) ?? '-'}  hi: ${r.hi.text || r.hi.error}  |  auto: ${r.auto.text || r.auto.error}`)
  }
  const ok = rows.filter((r) => !r.hi.error && !r.auto.error)
  console.log(`median ms  hi-IN ${median(ok.map((r) => r.hi.ms))}  unknown ${median(ok.map((r) => r.auto.ms))}`)
  console.log(`same text: ${ok.filter((r) => r.hi.text === r.auto.text).length}/${ok.length}`)
  const langs: Record<string, number> = {}
  for (const r of ok) langs[r.auto.lang ?? 'null'] = (langs[r.auto.lang ?? 'null'] ?? 0) + 1
  console.log('detected:', langs)
  return rows
}

/** Switch only on a confident line of 3+ words; start from the last call's language. */
function sticky(rows: EarRow[]) {
  const loaded = existsSync(`${OUT}/ears.json`) ? (JSON.parse(readFileSync(`${OUT}/ears.json`, 'utf8')) as EarRow[]) : []
  const data = rows.length ? rows : loaded
  console.log('\n== sticky (start hi-IN; switch when p >= 0.8 and >= 3 words)')
  let last = 'hi-IN', flips = 0, naive = 0
  for (const s of [...new Set(data.map((r) => r.session))]) {
    let lang = last, prevNaive = last
    const trail: string[] = []
    for (const r of data.filter((x) => x.session === s && !x.auto.error && x.auto.text)) {
      const words = r.auto.text.split(/\s+/).filter(Boolean).length
      if (r.auto.lang && r.auto.lang !== prevNaive) naive++
      if (r.auto.lang) prevNaive = r.auto.lang
      if (r.auto.lang && r.auto.lang !== lang && (r.auto.p ?? 0) >= 0.8 && words >= 3) { lang = r.auto.lang; flips++ }
      trail.push(`${r.auto.lang?.slice(0, 2) ?? '-'}->${lang.slice(0, 2)}`)
    }
    console.log(`${s}: ${trail.join(' ')}`)
    last = lang
  }
  console.log(`switches: sticky ${flips}, follow-every-line ${naive}`)
}

const AUTO_RULE =
  'Reply in the language she speaks, the way family does. If she mixes Hindi and English, mix the same way: Hindi words in Devanagari, ' +
  'English words in Latin script. If she speaks only English, reply in Indian English. If she speaks another Indian language ' +
  '(Tamil, Bengali, Telugu, Marathi, ...), reply in that language in its own script. One-word lines like "ok" or "हम्म" do not change the language. Before she has spoken, use Hinglish.'
const AUTO_REMINDER = 'Reply in her language, mixed the way she mixes it; each language in its own script.'
function autoPrompt(): string {
  const base = systemPrompt(persona('dad'), 'Papa', 'hinglish')
  const rule = /- Speak Hinglish the way[^\n]*\n/
  const reminder = 'Reply in Hinglish: Hindi words in Devanagari, English words in Latin script.'
  if (!rule.test(base) || !base.includes(reminder)) throw new Error('prompt changed; update lang-probe')
  return base.replace(rule, `- ${AUTO_RULE}\n`).replace(reminder, AUTO_REMINDER)
}

const OPEN = 'हाँ बेटा, बोलो।'
const BRAIN: { name: string; want: string; turns: string[] }[] = [
  { name: 'english', want: 'en-IN', turns: ["Hi Papa, I just got into the cab, I'll be home in twenty minutes."] },
  { name: 'hindi', want: 'hi-IN', turns: ['हाँ पापा, मैं कैब में बैठ गई हूँ, बीस मिनट में पहुँच जाऊँगी।'] },
  { name: 'hinglish', want: 'hi-IN', turns: ['हाँ papa, cab में बैठ गई, twenty minutes में पहुँच जाऊँगी।'] },
  { name: 'tamil', want: 'ta-IN', turns: ['அப்பா, நான் கேப்ல ஏறிட்டேன், இருபது நிமிஷத்துல வந்துடுவேன்.'] },
  { name: 'bengali', want: 'bn-IN', turns: ['বাবা, আমি ক্যাবে উঠে গেছি, কুড়ি মিনিটে পৌঁছে যাব।'] },
  { name: 'telugu', want: 'te-IN', turns: ['నాన్నా, నేను క్యాబ్ ఎక్కాను, ఇరవై నిమిషాల్లో వచ్చేస్తాను.'] },
  { name: 'hinglish then ok', want: 'hi-IN', turns: ['हाँ papa, cab में बैठ गई।', 'ok'] },
  { name: 'hinglish then english', want: 'en-IN', turns: ['हाँ papa, cab में बैठ गई।', "Actually the driver is taking a different route, I'm sharing my location."] },
  { name: 'english then hindi', want: 'hi-IN', turns: ["Hi Papa, I'm in the cab.", 'अच्छा सुनो, ड्राइवर बहुत तेज़ चला रहा है।'] },
]

async function llm(messages: { role: string; content: string }[]): Promise<{ text: string; ms: number }> {
  const t0 = Date.now()
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'phoney' },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 120, temperature: 0.8, reasoning: { effort: 'minimal' } }),
  })
  const j = await r.json()
  return { text: String(j.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 120)).trim(), ms: Date.now() - t0 }
}

async function brain() {
  const sys = autoPrompt()
  console.log(`\n== brain: ${LLM_MODEL}, "mirror her" prompt, 3 tries per case`)
  const jobs = BRAIN.flatMap((c) => [0, 1, 2].map(() => c))
  const res = await pool(jobs, 4, async (c) => {
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: '[call connected]' }, { role: 'assistant', content: OPEN }]
    for (const [i, t] of c.turns.entries()) {
      msgs.push({ role: 'user', content: t })
      if (i < c.turns.length - 1) msgs.push({ role: 'assistant', content: 'अच्छा, ठीक है।' })
    }
    return { c, ...(await llm(msgs)) }
  })
  let pass = 0
  for (const r of res) {
    const got = scriptLanguage(r.text)
    const ok = got === r.c.want
    if (ok) pass++
    console.log(`${ok ? 'ok  ' : 'MISS'} ${r.c.name.padEnd(22)} ${got}  ${r.text}`)
  }
  console.log(`pass ${pass}/${res.length}`)
  writeFileSync(`${OUT}/brain.json`, JSON.stringify(res.map((r) => ({ name: r.c.name, want: r.c.want, got: scriptLanguage(r.text), text: r.text, ms: r.ms })), null, 1))
}

const VOICE_LINES: Record<string, string> = {
  'hi-IN': 'अच्छा बेटा, गाड़ी का नंबर बता दो।',
  'en-IN': 'Okay beta, tell me the car number.',
  'ta-IN': 'சரி மா, காரோட நம்பர் சொல்லு.',
  'bn-IN': 'আচ্ছা মা, গাড়ির নম্বরটা বলো।',
  'te-IN': 'సరే అమ్మా, కారు నంబర్ చెప్పు.',
}
const VOICE_CASES: { role: string; speaker: string; lang: string }[] = [
  ...Object.keys(VOICE_LINES).map((lang) => ({ role: 'dad', speaker: 'sumit_hi_conversational', lang })),
  { role: 'dad', speaker: 'aravind_ta_ads', lang: 'ta-IN' },
  { role: 'dad', speaker: 'arnab_bn_conversation', lang: 'bn-IN' },
  { role: 'dad', speaker: 'tarun_te_narration', lang: 'te-IN' },
  ...['ta-IN', 'bn-IN', 'te-IN'].map((lang) => ({ role: 'mom', speaker: 'shreya_hi_conversational', lang })),
  { role: 'mom', speaker: 'roopa_bn_conversational', lang: 'bn-IN' },
  { role: 'mom', speaker: 'kavitha_te_conversation', lang: 'te-IN' },
]

async function voice() {
  console.log('\n== voice: his line, spoken then re-transcribed with `unknown`')
  const rows = await pool(VOICE_CASES, 3, async (c) => {
    const text = VOICE_LINES[c.lang]
    const t0 = Date.now()
    const r = await fetch('https://api.sarvam.ai/text-to-speech/stream', {
      method: 'POST', headers: { 'api-subscription-key': SARVAM, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model: 'bulbul:v4-flash', speaker: c.speaker, target_language_code: c.lang, speech_sample_rate: 24000, output_audio_codec: 'linear16' }),
    })
    if (!r.ok) return { ...c, error: `${r.status} ${(await r.text()).slice(0, 150)}` }
    const pcm = new Uint8Array(await r.arrayBuffer())
    const ms = Date.now() - t0
    const wav = pcmToWav(pcm, 24000)
    const file = `${OUT}/voice_${c.lang}_${c.speaker}.wav`
    writeFileSync(file, wav)
    const back = await stt(wav, 'unknown')
    return { ...c, ms, file, back }
  })
  for (const r of rows) {
    if ('error' in r && r.error) { console.log(`${r.role} ${r.speaker} ${r.lang}: ERROR ${r.error}`); continue }
    const b = (r as { back: Stt }).back
    console.log(`${r.role} ${r.speaker.padEnd(26)} ${r.lang}  heard as ${b.lang} p=${b.p?.toFixed(2)}  "${b.text}"`)
  }
  writeFileSync(`${OUT}/voice.json`, JSON.stringify(rows, null, 1))
}

/** One request at a time, alternating, so speed is comparable to a live call. */
async function lat() {
  const rows = JSON.parse(readFileSync(`${OUT}/ears.json`, 'utf8')) as EarRow[]
  const hi: number[] = [], auto: number[] = []
  for (const r of rows.filter((_, i) => i % 3 === 0)) {
    const wav = new Uint8Array(readFileSync(`logs/calls/${r.session}/${r.file}`))
    hi.push((await stt(wav, 'hi-IN')).ms)
    auto.push((await stt(wav, 'unknown')).ms)
  }
  console.log(`\n== latency, sequential, ${hi.length} lines: hi-IN median ${median(hi)} ms (${Math.min(...hi)}-${Math.max(...hi)}), unknown median ${median(auto)} ms (${Math.min(...auto)}-${Math.max(...auto)})`)
}

/** English cases with a language decided outside the LLM: an event tag, or today's English prompt. */
async function brain2() {
  const cases = BRAIN.filter((c) => c.want === 'en-IN' || c.name === 'hinglish then ok' || c.name === 'tamil')
  const variants = {
    tag: (lang: string) => ({ sys: autoPrompt(), tag: `\n[she is speaking ${lang}]` }),
    fixed: (lang: string) => ({ sys: systemPrompt(persona('dad'), 'Papa', lang === 'English' ? 'english' : 'hinglish'), tag: '' }),
  }
  const LANG: Record<string, string> = { 'en-IN': 'English', 'hi-IN': 'Hinglish', 'ta-IN': 'Tamil' }
  console.log('\n== brain2: language decided outside the LLM')
  for (const [name, v] of Object.entries(variants)) {
    if (name === 'fixed') continue
    const jobs = cases.flatMap((c) => [0, 1, 2].map(() => c))
    const res = await pool(jobs, 4, async (c) => {
      const { sys, tag } = v(LANG[c.want])
      const msgs = [{ role: 'system', content: sys }, { role: 'user', content: '[call connected]' }, { role: 'assistant', content: OPEN }]
      for (const [i, t] of c.turns.entries()) {
        msgs.push({ role: 'user', content: i === c.turns.length - 1 ? t + tag : t })
        if (i < c.turns.length - 1) msgs.push({ role: 'assistant', content: 'अच्छा, ठीक है।' })
      }
      return { c, ...(await llm(msgs)) }
    })
    for (const r of res) console.log(`${name.padEnd(5)} ${scriptLanguage(r.text) === r.c.want ? 'ok  ' : 'MISS'} ${r.c.name.padEnd(22)} ${r.text}`)
  }
  const fixedCases = cases.filter((c) => c.want === 'en-IN')
  const res = await pool(fixedCases.flatMap((c) => [0, 1, 2].map(() => c)), 4, async (c) => {
    const msgs = [{ role: 'system', content: variants.fixed('English').sys }, { role: 'user', content: '[call connected]' }, { role: 'assistant', content: OPEN }]
    for (const [i, t] of c.turns.entries()) {
      msgs.push({ role: 'user', content: t })
      if (i < c.turns.length - 1) msgs.push({ role: 'assistant', content: 'अच्छा, ठीक है।' })
    }
    return { c, ...(await llm(msgs)) }
  })
  for (const r of res) console.log(`fixed ${scriptLanguage(r.text) === r.c.want ? 'ok  ' : 'MISS'} ${r.c.name.padEnd(22)} ${r.text}`)
}

const what = process.argv[2] || 'all'
if (what === 'lat') await lat()
if (what === 'brain2') await brain2()
let rows: EarRow[] = []
if (what === 'ears' || what === 'all') rows = await ears()
if (what === 'sticky' || what === 'all') sticky(rows)
if (what === 'brain' || what === 'all') await brain()
if (what === 'voice' || what === 'all') await voice()
