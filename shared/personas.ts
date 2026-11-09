// Who can answer the call. Shared by the UI (labels) and the server (voice + prompt).

export type Language = 'hinglish' | 'hindi' | 'english'

/** A cloned voice: the TTS model imitates `ref` (an mp3 in server/voices/) whose words are `transcript`. */
export type ClonedVoice = { model: string; ref: string; transcript: string }

/** A Sarvam Bulbul voice (called directly, not via OpenRouter). Each call picks one at random. */
export type VoiceOption = { id: string; provider: 'sarvam'; model: string; speaker: string }

export type Persona = {
  id: string
  label: string
  defaultName: string
  relation: string
  gender: 'm' | 'f'
  /** Gemini TTS voice: the default, and the fallback when `clone` fails. */
  voice: string
  style: string
  /** How this person talks to her (forms of address, tone); added to the system prompt. */
  talk: string
  /** Preferred engine (fast, streams); falls back to Gemini `voice` on error. */
  clone?: ClonedVoice
  tested: boolean
  /** Selectable in the app; the rest show as "coming soon" until their voice is chosen. */
  available: boolean
  /** Primary voices, A/B tested: one is picked at random per call and logged. Falls back to `clone`, then Gemini. */
  voices?: VoiceOption[]
  /** Smallest AI Lightning voice id, tried after Sarvam (and `clone`) fail. */
  smallest: string
  /** Second Gemini voice, the last resort after `voice`. */
  backupVoice: string
}

const sarvam = (speaker: string): VoiceOption =>
  ({ id: `sarvam:${speaker}`, provider: 'sarvam', model: 'bulbul:v4-flash', speaker })


export const PERSONAS: Persona[] = [
  {
    id: 'dad', label: 'Dad', defaultName: 'Papa', relation: 'father', gender: 'm',
    voice: 'Algenib', backupVoice: 'Gacrux', smallest: 'ranbir', tested: true, available: true,
    voices: [sarvam('sumit_hi_conversational'), sarvam('girish_hi_devotional')],
    style: 'Indian father in his late fifties, deep, warm, unhurried, on the phone with his daughter',
    talk: 'Call her बेटा now and then. Calm and a little protective; a father of few words.',
    clone: {
      model: 'fish-audio/drama-3',
      ref: 'dad-algenib.mp3',
      transcript: 'हम्म, लिख लिया। हाँ, location share आ गया है। तो कितनी देर में पहुँच जाओगी?',
    },
  },
  {
    id: 'mom', label: 'Mom', defaultName: 'Mummy', relation: 'mother', gender: 'f',
    voice: 'Sulafat', backupVoice: 'Kore', smallest: 'irisha', tested: true, available: true,
    voices: [sarvam('shreya_hi_conversational'), sarvam('suchitra_hi_ecomm')],
    style: 'Indian mother in her fifties, warm, a little fussy, on the phone with her daughter',
    talk: 'Call her बेटा. Warm and a little fussy: food, sleep, "पहुँच के बताना".',
  },
  {
    id: 'brother', label: 'Brother', defaultName: 'Bhaiya', relation: 'elder brother', gender: 'm',
    voice: 'Orus', backupVoice: 'Sadaltager', smallest: 'aneer', tested: true, available: true,
    voices: [sarvam('shubh_enhi_companion'), sarvam('kabir_hi_conversational')],
    style: 'Indian man in his late twenties, relaxed, teasing but caring, on the phone with his younger sister',
    talk: 'Elder brother: light teasing, call her by name or छोटी, never बेटा. Protective underneath the jokes.',
  },
  {
    id: 'sister', label: 'Sister', defaultName: 'Didi', relation: 'elder sister', gender: 'f',
    voice: 'Leda', backupVoice: 'Achernar', smallest: 'ishani', tested: true, available: true,
    voices: [sarvam('aparna_hi_customer'), sarvam('sanchita_enhi_companion')],
    style: 'Indian woman in her late twenties from Delhi, casual and chatty, on the phone with her younger sister',
    talk: 'Elder sister: chatty, says यार, shares a bit of gossip, never बेटा. Big-sister protective.',
  },
  {
    id: 'friend_m', label: 'Friend (male)', defaultName: 'Dost', relation: 'close male friend', gender: 'm',
    voice: 'Sadaltager', backupVoice: 'Orus', smallest: 'vaibhav', tested: true, available: true,
    voices: [sarvam('shubh_enhi_companion'), sarvam('kabir_hi_conversational')],
    style: 'young Indian man in his twenties from Delhi, casual, friendly, on the phone with a close friend',
    talk: 'Close friend her own age: casual banter, says यार and bro-ish slang, never बेटा, never parental. Cares but plays it cool.',
  },
  {
    id: 'friend_f', label: 'Friend (female)', defaultName: 'Saheli', relation: 'close female friend', gender: 'f',
    voice: 'Achernar', backupVoice: 'Leda', smallest: 'zoya', tested: true, available: true,
    voices: [sarvam('aparna_hi_customer'), sarvam('sanchita_enhi_companion')],
    style: 'young Indian woman in her twenties from Delhi, casual, friendly, on the phone with a close friend',
    talk: 'Close friend her own age: easy chatter, says यार, small gossip and plans, never बेटा, never parental.',
  },
]

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'english', label: 'English (Indian)' },
]

export const DEFAULT_PERSONA = 'sister'

export function pickVoice(p: Persona): VoiceOption | undefined {
  return p.voices?.length ? p.voices[Math.floor(Math.random() * p.voices.length)] : undefined
}

export function persona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS.find((p) => p.id === DEFAULT_PERSONA)!
}
