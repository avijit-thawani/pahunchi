// Tests for following her language mid-call (shared/language.ts) and the English prompt.
//   node scripts/lang-switch.ts rule    free: replays the switch rule over her real lines
//                                       (logs/lang-probe/ears.json: both transcripts of each line)
//   node scripts/lang-switch.ts brain   paid, small: the app's LLM with the English prompt, every role:
//                                       opener, English lines, a Hindi call that turns English, a silence
// Output: logs/lang-switch/ (gitignored).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PERSONAS } from '../shared/personas.ts'
import { hear, nextLanguage, transcriptFor, type Detected } from '../shared/language.ts'
import type { Language } from '../shared/personas.ts'
import { systemPrompt } from '../server/prompt.ts'

for (const f of ['.env', '../.env']) {
  if (!existsSync(f)) continue
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\n]*)"?\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
const OUT = 'logs/lang-switch'
mkdirSync(OUT, { recursive: true })
const LLM_MODEL = process.env.PHONEY_LLM_MODEL || 'google/gemini-3.5-flash-lite'

function rule() {
  type Line = { session: string; hi: Detected; auto: Detected }
  const lines = JSON.parse(readFileSync('logs/lang-probe/ears.json', 'utf8')) as Line[]
  for (const start of ['hinglish', 'english'] as Language[]) {
    console.log(`\n== every call started in ${start}`)
    let session = '', lang = start, switches = 0, calls = 0
    for (const r of lines) {
      if (r.session !== session) { session = r.session; lang = start; calls++; console.log(`-- ${session}`) }
      const heard = hear(r.hi.text, r.auto)
      const next = nextLanguage(lang, heard)
      if (next !== lang) switches++
      const tag = heard ? heard.language + (heard.strong ? '!' : '') : '-'
      console.log(`${(next !== lang ? `-> ${next}` : '').padEnd(12)} ${tag.padEnd(9)} ${transcriptFor(next, heard, r.hi.text, r.auto)}`)
      lang = next
    }
    console.log(`${switches} switches over ${calls} calls`)
  }
}

// Hindi written in English letters; one of these in a reply means it is not an English sentence.
const ROMAN_HINDI = new Set(('hai hain ho hoon hu kya kab kahan kaha kitna kitni kaisa kaisi kaise bol bolo tak mein nahi nahin kar karo raha rahi rahe ' +
  'gayi gaya gaye tum tu tera teri mera meri ka ki ko abhi ghar pahunch pahunchi pahunchegi theek thik sun suno aaja aa jaldi lagega baat ' +
  'toh bhi woh yeh kuch bahut thoda bas hi na phir aur lekin matlab').split(' '))
const ALLOWED = /^(haan|achha|accha|arre|chalo|beta|yaar|ji|didi|bhaiya|papa|mummy|dadi|nani)$/

function judge(text: string): { english: boolean; why: string } {
  if (text === '...') return { english: true, why: 'silent' }
  if (/[\u0900-\u097F]/.test(text)) return { english: false, why: 'Devanagari' }
  const ws = text.toLowerCase().split(/[^a-z']+/).filter(Boolean)
  const hindi = ws.filter((w) => ROMAN_HINDI.has(w) && !ALLOWED.test(w))
  // "hi", "ho", "na", "aa" are also English or filler; alone they don't make a Hindi sentence
  const real = hindi.filter((w) => !/^(hi|ho|na|aa|bas|ka|ki|ko|tu)$/.test(w))
  if (real.length) return { english: false, why: `Hindi words: ${real.join(' ')}` }
  return { english: true, why: '' }
}

type Msg = { role: string; content: string }
async function llm(messages: Msg[]): Promise<string> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Pahunchi' },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 120, temperature: 0.8, reasoning: { effort: 'minimal' } }),
  })
  const j = await r.json()
  return String(j.choices?.[0]?.message?.content ?? `ERROR ${JSON.stringify(j).slice(0, 120)}`).trim()
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

/** `history`: lines before the test; `her`: her lines, each answered by the model in turn. */
type Case = { name: string; history: Msg[]; her: string[] }
const U = (content: string): Msg => ({ role: 'user', content })
const A = (content: string): Msg => ({ role: 'assistant', content })
const CASES: Case[] = [
  { name: 'opener', history: [], her: ['[call connected]'] },
  { name: 'alicia', history: [], her: ['[call connected]', 'Hi.', 'Hello.', 'Hello, good day.', 'Hello. Good to good to see you.', 'Hello.'] },
  { name: 'cab', history: [], her: ['[call connected]', "Hi, I just got into the cab. I'll be home in twenty minutes.", 'Yeah, the driver seems fine. What are you doing?', '[silence 40s]', 'Okay, I am almost there. Bye.'] },
  {
    name: 'hindi call turns english',
    history: [U('[call connected]'), A('हाँ, बोलो। कहाँ पहुँची?'), U('हाँ, बस cab में बैठी हूँ।'), A('अच्छा, ठीक है। गाड़ी का number भेज देना।')],
    her: ['Actually, my colleague is sitting next to me, so let me talk in English.', 'The driver is taking a different route, I am sharing my location with you.'],
  },
]

async function brain() {
  const jobs = PERSONAS.flatMap((p) => CASES.flatMap((c) => [0, 1].map((n) => ({ p, c, n }))))
  const res = await pool(jobs, 6, async ({ p, c, n }) => {
    const msgs: Msg[] = [{ role: 'system', content: systemPrompt(p, p.defaultName, 'english') }, ...c.history]
    const replies: string[] = []
    for (const line of c.her) {
      msgs.push(U(line))
      const text = await llm(msgs)
      msgs.push(A(text))
      replies.push(text)
    }
    return { persona: p.id, case: c.name, n, her: c.her, replies }
  })
  let ok = 0, total = 0
  const by: Record<string, [number, number]> = {}
  for (const r of res) {
    console.log(`\n-- ${r.persona} / ${r.case} #${r.n}`)
    r.replies.forEach((text, i) => {
      const j = judge(text)
      if (text !== '...') { total++; by[r.case] ??= [0, 0]; by[r.case][1]++; if (j.english) { ok++; by[r.case][0]++ } }
      console.log(`   U: ${r.her[i]}\n   ${j.english ? 'ok  ' : 'MISS'} AI: ${text}${j.why && !j.english ? `   [${j.why}]` : ''}`)
    })
  }
  console.log(`\n${LLM_MODEL}: ${ok}/${total} spoken replies in English`)
  for (const [k, [a, b]] of Object.entries(by)) console.log(`  ${k}: ${a}/${b}`)
  writeFileSync(`${OUT}/brain.json`, JSON.stringify(res, null, 1))
}

const cmd = process.argv[2]
if (cmd === 'rule') rule()
else if (cmd === 'brain') await brain()
else console.log('usage: node scripts/lang-switch.ts rule|brain')
