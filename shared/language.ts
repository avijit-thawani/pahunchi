// Following her language mid-call. Each of her lines is transcribed twice (server/api.ts): forced
// Hindi, and Sarvam's auto-detect. Auto-detect alone calls short Hindi lines English and translates
// them ("हाँ, चलो" -> "Ah, shut up"), so an English verdict also needs the Hindi transcript to
// hold no Hindi word: real English comes out of it as English in Devanagari ("हाय, हाउ आर यू?").

import type { Language } from './personas.ts'

export type Detected = { text: string; lang: string | null; p: number | null }
/** `strong`: enough words to switch the call on this line alone. */
export type Heard = { language: 'english' | 'hindi'; strong: boolean } | undefined

// Common Hindi words that no English word turns into when written in Devanagari
// (so not से "say", की "key", बस "bus", कर "car", तो, दो, ना, हो, लो).
const HINDI = new Set(('है हैं हूँ हाँ हां नहीं में मैं अभी क्या कहाँ कहां और था थी थे गई गया गए रहा रही रहे ठीक वो ये यह तुम तू तुमने तूने ' +
  'पता चलो अब आप मेरे मेरा मेरी तेरे तेरा तेरी मुझे तुझे कब कैसे क्यों कुछ बहुत थोड़ी थोड़ा वाला वाली लेकिन मतलब').split(' '))
const MIN_P = 0.9
const STRONG_WORDS = 3

const words = (t: string) => t.split(/[^\p{L}\p{M}\p{N}']+/u).filter(Boolean)
const english = (auto: Detected | null) => auto?.lang === 'en-IN' && (auto.p ?? 0) >= MIN_P && !!auto.text

/**
 * Which language this one line is in, or undefined when it can't be told (another language, noise).
 * Hindi is strong on two Hindi words, so "Haan, I'm in the cab" doesn't pull an English call back.
 */
export function hear(hindi: string, auto: Detected | null): Heard {
  const hindiWords = words(hindi).filter((w) => HINDI.has(w)).length
  if (hindiWords) return { language: 'hindi', strong: hindiWords >= 2 }
  if (english(auto)) {
    const en = words(auto!.text).filter((w) => /^[A-Za-z']+$/.test(w))
    if (en.length) return { language: 'english', strong: en.length >= STRONG_WORDS }
  }
  return undefined
}

/** The call's language after this line: it moves only on a line that is clearly in the other one. */
export function nextLanguage(current: Language, heard: Heard): Language {
  if (!heard?.strong) return current
  if (heard.language === 'english') return 'english'
  return current === 'english' ? 'hinglish' : current
}

/** The transcript the reply should read: in an English call the auto-detect one (Latin script), unless the line is Hindi. */
export function transcriptFor(language: Language, heard: Heard, hindi: string, auto: Detected | null): string {
  const isHindi = heard?.language === 'hindi' && heard.strong
  return language === 'english' && !isHindi && english(auto) ? auto!.text : hindi
}
