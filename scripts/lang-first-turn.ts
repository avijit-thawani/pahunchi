// First-turn language lock (docs/language.md): her first line reaches the reply LLM as two transcripts
// (Sarvam hi-IN + Sarvam auto-detect with its guess); the LLM starts its reply with <lang=xx>.
//   node scripts/lang-first-turn.ts synth   other-language lines voiced by Sarvam, transcribed both ways
//   node scripts/lang-first-turn.ts run     LLM tag + reply for every line (real + synthetic), 2 samples
//   node scripts/lang-first-turn.ts report  confusion matrix, reply-script match, time to tag
// VARIANT=today|neutral|classify picks the approach (see VARIANT below).
// Real lines: logs/lang-probe/ears.json (both transcripts) with their language from the STT
// reference (logs/stt-bench). Output: logs/lang-first/ (gitignored).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { persona } from '../shared/personas.ts'
import { systemPrompt } from '../server/prompt.ts'
import { pcmToWav } from '../server/log.ts'
import { language, OUT as BENCH } from './stt-bench.ts'

const OUT = 'logs/lang-first'
mkdirSync(OUT, { recursive: true })
const MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'
const OPEN = 'हाँ बेटा, बोलो।'
const CODES = ['hi', 'en', 'ta', 'te', 'bn', 'mr', 'kn', 'gu', 'ml', 'pa'] as const
/** today = app prompt + tag rule; neutral = language-neutral prompt + tag rule; classify = separate small call. */
const VARIANT = process.env.VARIANT || 'today'
const load = <T>(f: string, d: T): T => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : d)

type Stt = { text: string; lang: string | null; p: number | null }
type Line = { id: string; truth: string; hi: Stt; auto: Stt; synthetic?: boolean }

// Short first lines a daughter might say, per language (synthetic: Sarvam voice, clean audio).
const SYNTH: Record<string, string[]> = {
  'ta-IN': ['ஹலோ அப்பா', 'ஆமா, கேப்ல ஏறிட்டேன்', 'இன்னும் இருபது நிமிஷம் ஆகும்', 'சரி'],
  'te-IN': ['హలో నాన్నా', 'అవును, క్యాబ్ ఎక్కాను', 'ఇంకా ఇరవై నిమిషాలు పడుతుంది', 'సరే'],
  'bn-IN': ['হ্যালো বাবা', 'হ্যাঁ, ক্যাবে উঠে গেছি', 'আরও কুড়ি মিনিট লাগবে', 'আচ্ছা'],
  'mr-IN': ['हॅलो बाबा', 'हो, कॅबमध्ये बसले', 'अजून वीस मिनिटं लागतील', 'बरं'],
  'kn-IN': ['ಹಲೋ ಅಪ್ಪ', 'ಹೌದು, ಕ್ಯಾಬ್ ಹತ್ತಿದೆ', 'ಇನ್ನೂ ಇಪ್ಪತ್ತು ನಿಮಿಷ ಆಗುತ್ತೆ', 'ಸರಿ'],
}
const HER_VOICE = 'aparna_hi_customer'

async function sarvamStt(wav: Uint8Array, code: string): Promise<Stt> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'her.wav')
  form.append('model', 'saaras:v4')
  form.append('mode', 'transcribe')
  form.append('language_code', code)
  const r = await fetch('https://api.sarvam.ai/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY! }, body: form })
  const j = await r.json()
  return { text: String(j.transcript ?? '').trim(), lang: j.language_code ?? null, p: j.language_probability ?? null }
}

async function synth() {
  const out: Line[] = []
  for (const [code, lines] of Object.entries(SYNTH)) {
    for (const [i, text] of lines.entries()) {
      const r = await fetch('https://api.sarvam.ai/text-to-speech/stream', {
        method: 'POST', headers: { 'api-subscription-key': process.env.SARVAM_API_KEY!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model: 'bulbul:v4-flash', speaker: HER_VOICE, target_language_code: code, speech_sample_rate: 16000, output_audio_codec: 'linear16' }),
      })
      const wav = pcmToWav(new Uint8Array(await r.arrayBuffer()), 16000)
      writeFileSync(`${OUT}/synth_${code}_${i}.wav`, wav)
      const [hi, auto] = [await sarvamStt(wav, 'hi-IN'), await sarvamStt(wav, 'unknown')]
      out.push({ id: `synth/${code}/${i}`, truth: code.slice(0, 2), hi, auto, synthetic: true })
      console.log(code, text, '| hi-IN:', hi.text, '| auto:', auto.lang, auto.p, auto.text)
      await new Promise((ok) => setTimeout(ok, 1200))
    }
  }
  writeFileSync(`${OUT}/synth.json`, JSON.stringify(out, null, 1))
}

function realLines(): Line[] {
  const ears = load<{ session: string; file: string; hi: Stt; auto: Stt }[]>('logs/lang-probe/ears.json', [])
  const gold = load<Record<string, { text: string }>>(`${BENCH}/gold.json`, {})
  const ref = load<Record<string, { transcript: string }>>(`${BENCH}/referee/google_gemini-4-argon.json`, {})
  return ears.map((e) => {
    const key = `${e.session}/${e.file.split('_')[0]}`
    const l = language(gold[key]?.text ?? ref[key]?.transcript ?? '')
    return { id: key, truth: l === 'English' ? 'en' : l === 'none' ? 'none' : 'hi', hi: e.hi, auto: e.auto }
  }).filter((x) => x.truth !== 'none' && (x.hi.text || x.auto.text))
}

const TAG_RULE = `
Her first line reaches you as two speech-to-text versions of the same audio: A assumed Hindi, B auto-detected the language (its guess shown). Either can be wrong; short lines are often misdetected.
Before your reply, write her language as a tag: <lang=xx> where xx is one of ${CODES.join(', ')} (hi covers Hindi and Hinglish). Then reply in that language, as a family member who speaks it would, in its own script (English words in Latin script).`

/** VARIANT=neutral: the Hinglish rule, reminder and Hindi examples swapped for language-neutral ones. */
function neutral(sys: string): string {
  const rule = /- Speak Hinglish the way[^\n]*\n/
  const reminder = 'Reply in Hinglish: Hindi words in Devanagari, English words in Latin script.'
  if (!rule.test(sys) || !sys.includes(reminder)) throw new Error('prompt changed; update lang-first-turn')
  return sys.replace(rule, '- Speak the language she speaks, the way a family member who speaks it would.\n')
    .replace(reminder, 'Reply in her language, in its own script.')
    .replace('("हाँ? आवाज़ कट रही है")', '(a short "sorry, line is bad" in her language)')
    .replace(/\("[^"]*location[^"]*"\)/, '')
}

const CLASSIFY = `You identify the language a young woman in India is speaking on a phone call, from two speech-to-text versions of one short line.
A assumed Hindi, so it writes any language in Devanagari: English shows up as phonetic Devanagari ("आई डोंट नो"), and other languages as odd Hindi-looking words or even a Hindi translation.
B auto-detected; its guess is usually right for Tamil, Telugu, Bengali, Marathi, Kannada and other Indian languages, but on very short lines it often says English for Hindi.
Greetings like "Hello papa" alone don't decide: prefer hi unless the rest of the evidence points elsewhere.
Answer with only one code: ${CODES.join(', ')} (hi = Hindi or Hinglish).`

async function classify(l: Line): Promise<{ tag: string | null; ms: number }> {
  const t0 = Date.now()
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 5, temperature: 0, reasoning: { effort: 'minimal' }, messages: [
      { role: 'system', content: CLASSIFY }, { role: 'user', content: herLine(l) }] }),
  })
  const j = await r.json()
  const code = String(j.choices?.[0]?.message?.content ?? '').trim().toLowerCase().slice(0, 2)
  return { tag: (CODES as readonly string[]).includes(code) ? code : null, ms: Date.now() - t0 }
}

const herLine = (l: Line) => `A (Hindi): ${l.hi.text || '(empty)'}\nB (auto, guessed ${l.auto.lang ?? 'none'}${l.auto.p != null ? ` p=${Number(l.auto.p).toFixed(2)}` : ''}): ${l.auto.text || '(empty)'}`

function messages(l: Line) {
  const base = systemPrompt(persona('dad'), 'Papa', 'hinglish')
  const sys = (process.env.VARIANT === 'neutral' ? neutral(base) : base) + '\n' + TAG_RULE
  return [{ role: 'system', content: sys }, { role: 'user', content: '[call connected]' }, { role: 'assistant', content: OPEN }, { role: 'user', content: herLine(l) }]
}

const SCRIPTS: [RegExp, string][] = [
  [/[\u0900-\u097F]/g, 'hi'], [/[\u0980-\u09FF]/g, 'bn'], [/[\u0A00-\u0A7F]/g, 'pa'], [/[\u0A80-\u0AFF]/g, 'gu'],
  [/[\u0B80-\u0BFF]/g, 'ta'], [/[\u0C00-\u0C7F]/g, 'te'], [/[\u0C80-\u0CFF]/g, 'kn'], [/[\u0D00-\u0D7F]/g, 'ml'],
]
function scriptOf(t: string): string {
  let best = 'en', n = 0
  for (const [re, c] of SCRIPTS) { const k = t.match(re)?.length ?? 0; if (k > n) [best, n] = [c, k] }
  return best
}

async function stream(l: Line) {
  const t0 = Date.now()
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: messages(l), max_tokens: 140, temperature: 0.8, reasoning: { effort: 'minimal' }, stream: true }),
  })
  const reader = r.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buf = '', text = '', tagMs: number | undefined
  for (;;) {
    const { done, value } = await reader.read()
    if (value) buf += value
    const lines = buf.split('\n'); buf = done ? '' : lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue
      try { text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? '' } catch { /* keep-alive */ }
      if (tagMs === undefined && />/.test(text)) tagMs = Date.now() - t0
    }
    if (done) break
  }
  const tag = /<lang=([a-z]{2})>/.exec(text)?.[1] ?? null
  const reply = text.replace(/<lang=[a-z]{2}>/, '').trim()
  return { tag, reply, replyScript: scriptOf(reply), tagMs, ms: Date.now() - t0 }
}

async function run() {
  const lines = [...realLines(), ...load<Line[]>(`${OUT}/synth.json`, [])]
  const out: Record<string, unknown>[] = []
  let i = 0
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < lines.length) {
      const l = lines[i++]
      for (let s = 0; s < 2; s++) {
        const r = VARIANT === 'classify' ? { ...(await classify(l)), reply: '', replyScript: '', tagMs: undefined as number | undefined } : await stream(l)
        if (VARIANT === 'classify') r.tagMs = r.ms
        out.push({ id: l.id, truth: l.truth, synthetic: !!l.synthetic, autoGuess: l.auto.lang?.slice(0, 2) ?? null, autoP: l.auto.p, ...r })
      }
    }
  }))
  writeFileSync(`${OUT}/run-${VARIANT}.json`, JSON.stringify(out, null, 1))
  console.log(`${out.length} replies`)
}

function report() {
  type R = { id: string; truth: string; synthetic: boolean; autoGuess: string | null; autoP: number | null; tag: string | null; reply: string; replyScript: string; tagMs?: number }
  const rows = load<R[]>(`${OUT}/run-${VARIANT}.json`, [])
  const groups: [string, (r: R) => boolean][] = [
    ['Hindi/Hinglish (real)', (r) => !r.synthetic && r.truth === 'hi'], ['English (real)', (r) => !r.synthetic && r.truth === 'en'],
    ...Object.keys(SYNTH).map((c): [string, (r: R) => boolean] => [`${c.slice(0, 2)} (synthetic)`, (r) => r.synthetic && r.truth === c.slice(0, 2)]),
  ]
  const lines = ['| Her language | Replies | LLM tag right | Auto-detect alone right | Reply in tagged language | Tags given |', '|---|---|---|---|---|---|']
  for (const [name, f] of groups) {
    const g = rows.filter(f)
    if (!g.length) continue
    const counts: Record<string, number> = {}
    for (const r of g) counts[r.tag ?? 'none'] = (counts[r.tag ?? 'none'] ?? 0) + 1
    const pct = (n: number) => `${n}/${g.length}`
    lines.push(`| ${name} | ${g.length} | ${pct(g.filter((r) => r.tag === r.truth).length)} | ${pct(g.filter((r) => (r.autoGuess === 'en' && (r.autoP ?? 0) >= 0.8 ? 'en' : r.autoGuess && r.autoGuess !== 'en' ? r.autoGuess : 'hi') === r.truth).length)} | ` +
      `${pct(g.filter((r) => r.tag && (r.replyScript === r.tag || (r.tag === 'mr' && r.replyScript === 'hi'))).length)} | ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')} |`)
  }
  const tagMs = rows.map((r) => r.tagMs).filter((x): x is number => !!x).sort((a, b) => a - b)
  lines.push('', `Time to tag (request -> ">" of the tag): median ${tagMs[Math.floor(tagMs.length / 2)]} ms, p90 ${tagMs[Math.floor(tagMs.length * 0.9)]} ms over ${tagMs.length} replies.`,
    'Auto-detect alone = Sarvam `unknown` guess, English only when p >= 0.8, else Hindi.')
  const wrong = rows.filter((r) => r.tag !== r.truth).slice(0, 15).map((r) => `- ${r.id} truth ${r.truth}, tag ${r.tag}: ${r.reply.slice(0, 70)}`)
  lines.push('', '## Wrong tags (first 15)', '', ...wrong)
  writeFileSync(`${OUT}/report-${VARIANT}.md`, lines.join('\n'))
  console.log(lines.join('\n'))
}

const cmd = process.argv[2]
if (cmd === 'synth') await synth()
else if (cmd === 'run') await run()
else if (cmd === 'report') report()
else console.log('usage: lang-first-turn.ts synth | run | report')
