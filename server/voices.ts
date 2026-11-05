// Reference clips for cloned voices (server/voices/*.mp3), sent with every cloned TTS request as
// OpenRouter `input_references`. Netlify bundles them via `included_files` in netlify.toml.

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClonedVoice } from '../shared/personas.ts'

const cache = new Map<string, string>()

function candidates(file: string): string[] {
  const out = [path.resolve('server/voices', file)]
  try {
    out.push(path.join(path.dirname(fileURLToPath(import.meta.url)), 'voices', file))
  } catch {
    // no import.meta.url in some bundles
  }
  return out
}

async function dataUri(file: string): Promise<string> {
  const hit = cache.get(file)
  if (hit) return hit
  for (const p of candidates(file)) {
    try {
      const uri = `data:audio/mpeg;base64,${(await readFile(p)).toString('base64')}`
      cache.set(file, uri)
      return uri
    } catch {
      // try the next location
    }
  }
  throw new Error(`voice reference ${file} not found`)
}

export async function inputReferences(v: ClonedVoice) {
  return [
    { type: 'input_audio', input_audio: { data: await dataUri(v.ref) } },
    { type: 'text', text: v.transcript },
  ]
}
