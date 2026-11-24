// Following her language mid-call. Each of her lines is also transcribed in Sarvam's `codemix`
// mode (server/api.ts), which writes English words in Latin letters and Hindi words in Devanagari,
// so the script of that transcript says what she spoke. The other modes can't be trusted for this:
// forced Hindi translates spoken English into Hindi ("Can you hear me?" -> "क्या आप मुझे सुन रहे हैं?")
// and auto-detect translates short Hindi into English ("हाँ, चलो" -> "Ah, shut up").

import type { Language } from './personas.ts'

/** `strong`: enough words to switch the call on this line alone. */
export type Heard = { language: 'english' | 'hindi'; strong: boolean } | undefined

const words = (t: string) => t.split(/[^\p{L}\p{M}']+/u).filter(Boolean)

/** Which language this one line is in, or undefined when there is nothing to go on. */
export function hear(codemix: string | null): Heard {
  const ws = words(codemix ?? '')
  // Two Hindi words, so "Hello पापा" or a misheard "सीलिंग" doesn't pull an English call back.
  const hindi = ws.filter((w) => /[\u0900-\u097F]/.test(w)).length
  if (hindi) return { language: 'hindi', strong: hindi >= 2 }
  // Three different English words, so "Okay", "Hello, hello, hello" or a cab's "White Dzire" doesn't switch a Hindi call.
  const english = new Set(ws.filter((w) => /^[A-Za-z']+$/.test(w)).map((w) => w.toLowerCase())).size
  if (english) return { language: 'english', strong: english >= 3 }
  return undefined
}

/** The call's language after this line: it moves only on a line that is clearly in the other one. */
export function nextLanguage(current: Language, heard: Heard): Language {
  if (!heard?.strong) return current
  if (heard.language === 'english') return 'english'
  return current === 'english' ? 'hinglish' : current
}

/** The transcript the reply should read: in an English call the codemix one, so English stays in Latin letters. */
export function transcriptFor(language: Language, hindi: string, codemix: string | null): string {
  return language === 'english' && codemix ? codemix : hindi
}
