// Splits a streamed reply into speakable pieces so TTS can start before the reply is complete.
// First clause: cut at . ? ! ।, at a comma once 12+ characters are in, or at ~60 characters.
// Later clauses: whole sentences, short ones (< 12 chars) merged into the next.

const END = /[.?!।]+["”'’)]*\s|[?!।]+["”'’)]*$/g
const COMMA = /[,،]\s/g
const FIRST_MIN = 12
const FIRST_MAX = 60

/** Text worth sending to TTS (not just dots, quotes or the SILENT marker). */
export function speakable(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s)
}

function clean(s: string): string {
  return s.replace(/["“”]/g, '').replace(/\s+/g, ' ').trim()
}

export class Clauses {
  private buf = ''
  private count = 0

  /** Add streamed text; returns any clauses that are now complete. */
  push(delta: string): string[] {
    this.buf += delta
    return this.drain(false)
  }

  /** The reply is finished: everything left is the last clause. */
  flush(): string[] {
    return this.drain(true)
  }

  private drain(final: boolean): string[] {
    const out: string[] = []
    for (;;) {
      const cut = this.cut(final)
      if (cut <= 0) break
      const clause = clean(this.buf.slice(0, cut))
      this.buf = this.buf.slice(cut)
      if (speakable(clause)) {
        out.push(clause)
        this.count++
      }
    }
    return out
  }

  private cut(final: boolean): number {
    const b = this.buf
    if (!b) return 0
    const first = this.count === 0
    const min = first ? 1 : FIRST_MIN
    const at = (re: RegExp, from: number) => {
      re.lastIndex = 0
      for (let m = re.exec(b); m; m = re.exec(b)) if (m.index >= from) return m.index + m[0].length
      return -1
    }
    let cut = at(END, min)
    if (first) {
      const comma = at(COMMA, FIRST_MIN)
      if (comma > 0 && (cut < 0 || comma < cut)) cut = comma
      if (cut < 0 && b.length >= FIRST_MAX) {
        const space = b.lastIndexOf(' ', FIRST_MAX)
        cut = space >= FIRST_MIN ? space + 1 : FIRST_MAX
      }
    }
    if (cut < 0 && final) cut = b.length
    return cut
  }
}
