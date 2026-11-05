// Who can answer the call. Shared by the UI (labels) and the server (voice + prompt).

export type Language = 'hinglish' | 'hindi' | 'english'

/** A cloned voice: the TTS model imitates `ref` (an mp3 in server/voices/) whose words are `transcript`. */
export type ClonedVoice = { model: string; ref: string; transcript: string }

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
}

export const PERSONAS: Persona[] = [
  {
    id: 'dad', label: 'Dad', defaultName: 'Papa', relation: 'father', gender: 'm',
    voice: 'Algenib', tested: true,
    style: 'Indian father in his late fifties, deep, warm, unhurried, on the phone with his daughter',
    clone: {
      model: 'fish-audio/drama-3',
      ref: 'dad-algenib.mp3',
      transcript: 'हम्म, लिख लिया। हाँ, location share आ गया है। तो कितनी देर में पहुँच जाओगी?',
    },
  },
  {
    id: 'mom', label: 'Mom', defaultName: 'Mummy', relation: 'mother', gender: 'f',
    voice: 'Sulafat', tested: false,
    style: 'Indian mother in her fifties, warm, a little fussy, on the phone with her daughter',
  },
  {
    id: 'brother', label: 'Brother', defaultName: 'Bhaiya', relation: 'elder brother', gender: 'm',
    voice: 'Orus', tested: false,
    style: 'Indian man in his late twenties, relaxed, teasing but caring, on the phone with his younger sister',
  },
  {
    id: 'sister', label: 'Sister', defaultName: 'Didi', relation: 'elder sister', gender: 'f',
    voice: 'Leda', tested: false,
    style: 'Indian woman in her late twenties from Delhi, casual and chatty, on the phone with her younger sister',
  },
  {
    id: 'friend_m', label: 'Friend (male)', defaultName: 'Rohan', relation: 'close male friend', gender: 'm',
    voice: 'Sadaltager', tested: false,
    style: 'young Indian man in his twenties from Delhi, casual, friendly, on the phone with a close friend',
  },
  {
    id: 'friend_f', label: 'Friend (female)', defaultName: 'Ananya', relation: 'close female friend', gender: 'f',
    voice: 'Achernar', tested: false,
    style: 'young Indian woman in her twenties from Delhi, casual, friendly, on the phone with a close friend',
  },
]

export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'english', label: 'English (Indian)' },
]

export function persona(id: string): Persona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0]
}
