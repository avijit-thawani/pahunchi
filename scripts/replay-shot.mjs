// Stills and videos of a call replay (scripts/replay.ts builds the page first).
//   node scripts/replay-shot.mjs serve               http://localhost:5199/replay/ to click Replay with sound
//   node scripts/replay-shot.mjs index               logs/replay/index.png: every call's step breakdown
//   node scripts/replay-shot.mjs <id>                logs/replay/<id>.png (whole page) + <id>-live.png (mid-turn)
//   node scripts/replay-shot.mjs <id> --video        + logs/replay/<id>.mp4: the page replayed in real time
//                                                    with the call's logged audio mixed in by ffmpeg
// Uses the headless shell from ../scratch/ai-video (never a system browser); audio stays muted.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { launchMobile, recordCDP, sleep } from '../../scratch/ai-video/tools/headless.mjs'

const LOGS = path.resolve('logs')
const PORT = 5199
const TYPES = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav', '.json': 'application/json', '.webm': 'audio/webm' }

function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(LOGS, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'))
    if (!p.startsWith(LOGS) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' })
    fs.createReadStream(p).pipe(res)
  })
  return new Promise((r) => server.listen(PORT, '127.0.0.1', () => r(server)))
}

/** The call's clips mixed at their replay times, as one WAV (what the page plays). */
function mix(r, out) {
  const clips = r.clips.filter((c) => fs.existsSync(path.join(LOGS, 'replay', c.src)))
  const args = ['-v', 'error', '-y']
  clips.forEach((c) => args.push('-i', path.join(LOGS, 'replay', c.src)))
  const chains = clips.map((c, i) => `[${i}:a]aresample=24000,aformat=channel_layouts=mono,adelay=${Math.max(0, Math.round(c.start * 1000))}[a${i}]`)
  const inputs = clips.map((_, i) => `[a${i}]`).join('')
  args.push('-filter_complex', `${chains.join(';')};${inputs}amix=inputs=${clips.length}:normalize=0,apad=whole_dur=${r.durationS}[m]`, '-map', '[m]', out)
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (res.status !== 0) throw new Error(res.stderr)
}

const [cmd, ...rest] = process.argv.slice(2)
if (!cmd) { console.log('usage: replay-shot.mjs serve | <id> [--video]'); process.exit(1) }
const server = await serve()
if (cmd === 'serve') {
  console.log(`http://localhost:${PORT}/replay/  (Ctrl-C to stop)`)
} else if (cmd === 'index') {
  const { browser, page } = await launchMobile({ width: 1000, height: 600, deviceScaleFactor: 2 })
  await page.goto(`http://localhost:${PORT}/replay/index.html`, { waitUntil: 'load' })
  await page.screenshot({ path: path.join(LOGS, 'replay', 'index.png'), fullPage: true })
  console.log(path.join(LOGS, 'replay', 'index.png'))
  await browser.close()
  server.close()
} else {
  const id = cmd
  const r = JSON.parse(fs.readFileSync(path.join(LOGS, 'replay', `${id}.json`), 'utf8'))
  const { browser, page } = await launchMobile({ width: 960, height: 900, deviceScaleFactor: 2 })
  await page.goto(`http://localhost:${PORT}/replay/${id}.html`, { waitUntil: 'load' })
  await sleep(300)
  const out = path.join(LOGS, 'replay', id)
  await page.screenshot({ path: `${out}.png`, fullPage: true })
  const t = r.turns.find((x) => x.her && !x.estimated) ?? r.turns[0]
  await page.evaluate((at) => { window.__follow = true; window.__replay.render(at); document.getElementById('lap').style.display = 'block' }, t.herEnd + (t.totalMs * 0.6) / 1000)
  await sleep(300)
  await page.screenshot({ path: `${out}-live.png` })
  console.log(`${out}.png\n${out}-live.png`)

  if (rest.includes('--video')) {
    await page.evaluate(() => { window.scrollTo(0, 0) })
    const silent = `${out}.silent.mp4`
    const rec = await recordCDP(page, silent, async () => {
      await page.evaluate((dur) => new Promise((done) => {
        const t0 = performance.now()
        const step = () => {
          const at = (performance.now() - t0) / 1000
          window.__replay.render(at)
          if (at < dur) requestAnimationFrame(step); else done()
        }
        requestAnimationFrame(step)
      }), r.durationS)
    }, { maxWidth: 1920, maxHeight: 1800 })
    const wav = `${out}.mix.wav`
    mix(r, wav)
    const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', `${out}.mp4`], { encoding: 'utf8' })
    if (res.status !== 0) throw new Error(res.stderr)
    fs.rmSync(silent); fs.rmSync(wav)
    console.log(`${out}.mp4  (${rec.seconds} s, ${rec.frames} frames)`)
  }
  await browser.close()
  server.close()
}
