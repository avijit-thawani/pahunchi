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
  /** Preferred engine (fast, streams); falls back to Gemini `voice` on error. */
  clone?: ClonedVoice
  tested: boolean
  /** Selectable in the app; the rest show as "coming soon" until their voice is chosen. */
  available: boolean
  /** Primary voices, A/B tested: one is picked at random per call and logged. Falls back to `clone`, then Gemini. */
  voices?: VoiceOption[]
}

const sarvam = (speaker: string): VoiceOption =>
  ({ id: `sarvam:${speaker}`, provider: 'sarvam', model: 'bulbul:v4-flash', speaker })


export const PERSONAS: Persona[] = [
  {
    id: 'dad', label: 'Dad', defaultName: 'Papa', relation: 'father', gender: 'm',
    voice: 'Algenib', tested: true, available: true,
    voices: [sarvam('sumit_hi_conversational'), sarvam('girish_hi_devotional')],
    style: 'Indian father in his late fifties, deep, warm, unhurried, on the phone with his daughter',
    clone: {
      model: 'fish-audio/drama-3',
      ref: 'dad-algenib.mp3',
      transcript: 'हम्म, लिख लिया। हाँ, location share आ गया है। तो कितनी देर में पहुँच जाओगी?',
    },
  },
  {
    id: 'mom', label: 'Mom', defaultName: 'Mummy', relation: 'mother', gender: 'f',
    voice: 'Sulafat', tested: true, available: true,
    voices: [sarvam('shreya_hi_conversational'), sarvam('suchitra_hi_ecomm')],
    style: 'Indian mother in her fifties, warm, a little fussy, on the phone with her daughter',
  },
  {
    id: 'brother', label: 'Brother', defaultName: 'Bhaiya', relation: 'elder brother', gender: 'm',
    voice: 'Orus', tested: true, available: true,
    voices: [sarvam('shubh_enhi_companion'), sarvam('kabir_hi_conversational')],
    style: 'Indian man in his late twenties, relaxed, teasing but caring, on the phone with his younger sister',
  },
  {
    id: 'sister', label: 'Sister', defaultName: 'Didi', relation: 'elder sister', gender: 'f',
    voice: 'Leda', tested: true, available: true,
    voices: [sarvam('aparna_hi_customer'), sarvam('sanchita_enhi_companion')],
    style: 'Indian woman in her late twenties from Delhi, casual and chatty, on the phone with her younger sister',
  },
  {
    id: 'friend_m', label: 'Friend (male)', defaultName: 'Rohan', relation: 'close male friend', gender: 'm',
    voice: 'Sadaltager', tested: false, available: false,
    style: 'young Indian man in his twenties from Delhi, casual, friendly, on the phone with a close friend',
  },
  {
    id: 'friend_f', label: 'Friend (female)', defaultName: 'Ananya', relation: 'close female friend', gender: 'f',
    voice: 'Achernar', tested: false, available: false,
    style: 'young Indian woman in her twenties from Delhi, casual, friendly, on the phone with a close friend',
  },
]

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'english', label: 'English (Indian)' },
]

export const DEFAULT_PERSONA = 'dad'

export function pickVoice(p: Persona): VoiceOption | undefined {
  return p.voices?.length ? p.voices[Math.floor(Math.random() * p.voices.length)] : undefined
}

export function persona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}
