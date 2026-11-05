# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy"]
# ///
"""Voice lab: audition TTS voices, render scripted calls, mix them like a real phone call.

  uv run sim/lab.py audition     # one girl line + one dad line per candidate voice, judged
  uv run sim/lab.py ambience     # cab / street / TV room beds via Seed Audio
  uv run sim/lab.py scenes       # every scene with the best voice per model
  uv run sim/lab.py mix          # phone-band dad + ambience -> sim/out/mix/*.mp3
  uv run sim/lab.py page         # sim/out/index.html to compare by ear
  uv run sim/lab.py all
Outputs are cached: delete a file to regenerate it.
"""

from __future__ import annotations

import html
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import orlib

SIM = Path(__file__).resolve().parent
OUT = SIM / "out"
SR = 24000
SCENES = json.loads((SIM / "scenes.json").read_text())["scenes"]
JUDGE = "google/gemini-3.8-flash"

GIRL_STYLE = "young woman from Delhi, casual phone call with her father, natural Indian accent, relaxed"
DAD_STYLE = "Indian father in his late fifties, deep, warm, unhurried, on the phone with his daughter"
GIRL_DESC = "A young Indian woman in her twenties from Delhi, relaxed, on a phone call with her father, says:"
DAD_DESC = "An Indian man in his late fifties with a deep, warm, slightly heavy voice, on the phone with his daughter, says:"

# model -> (price per input char, {role: [voices]}). None = model picks / describes the voice.
CANDIDATES: dict[str, tuple[float, dict[str, list[str | None]]]] = {
    "google/gemini-3.8-flash-tts": (0.00006, {
        "girl": ["Sulafat", "Kore", "Leda", "Aoede", "Despina", "Achernar"],
        "dad": ["Algenib", "Charon", "Gacrux", "Iapetus", "Orus", "Sadaltager"]}),
    "google/gemini-3.8-flash-lite-tts": (0.00004, {"girl": ["Sulafat"], "dad": ["Algenib"]}),
    "microsoft/mai-voice-2.1": (0.000022, {
        "girl": ["hi-IN-Kavya:MAI-Voice-2.1", "hi-IN-Priya:MAI-Voice-2.1", "hi-IN-Harper:MAI-Voice-2.1"],
        "dad": ["hi-IN-Arjun:MAI-Voice-2.1", "hi-IN-Dhruv:MAI-Voice-2.1", "hi-IN-Grant:MAI-Voice-2.1"]}),
    "microsoft/mai-voice-2.1-flash": (0.000015, {
        "girl": ["hi-IN-Kavya:MAI-Voice-2.1-Flash"], "dad": ["hi-IN-Arjun:MAI-Voice-2.1-Flash"]}),
    "elevenlabs/eleven-v3": (0.00008, {"girl": ["lily", "jessica", "sarah"], "dad": ["george", "bill", "brian"]}),
    "x-ai/grok-voice-tts-1.0": (0.000015, {"girl": ["ara", "eve"], "dad": ["rex", "sal", "leo"]}),
    "fish-audio/s2.1-pro": (0.000015, {"girl": [None], "dad": [None]}),
    "fish-audio/drama-3": (0.000002, {"girl": [None], "dad": [None]}),
    "bytedance-seed/seed-audio-1-0": (0.004, {"girl": [None], "dad": [None]}),
}
# Models whose voice can't be pinned get no full scenes (speaker would drift between lines).
SCENE_MODELS = ["google/gemini-3.8-flash-tts", "microsoft/mai-voice-2.1", "elevenlabs/eleven-v3",
                "x-ai/grok-voice-tts-1.0"]

AUDITION_LINES = {"girl": SCENES[0]["lines"][2], "dad": SCENES[0]["lines"][3]}

AMBIENCE = {
    "cab": "Inside a small car taxi moving through Delhi traffic at night: steady engine hum, tyre noise, "
           "AC fan, occasional distant horns. No voices, no music.",
    "street": "A quiet residential street in an Indian city at night: distant traffic, a scooter passing, "
              "dogs barking far away, footsteps. No voices, no music.",
    "tv": "An Indian living room at night: a Hindi TV news channel playing quietly in the background, a "
          "ceiling fan whirring. Speech on the TV is faint and unintelligible.",
}


def slug(s: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", s or "auto").strip("-").lower()


def synth(model: str, voice: str | None, role: str, text: str, out: Path, label: str) -> dict:
    """Synthesize with the right steering for each provider family. Cached on disk."""
    hit = next(iter(out.parent.glob(out.name + ".*")), None) if out.parent.exists() else None
    if hit:
        return {"path": hit, "latency_s": None, "cached": True}
    price = CANDIDATES[model][0]
    instructions = None
    if model.startswith("google/"):
        instructions = GIRL_STYLE if role == "girl" else DAD_STYLE
    elif model.startswith("fish-audio/"):
        instructions = ("young Indian woman, relaxed, phone call" if role == "girl"
                        else "older Indian man, deep warm voice, phone call")
    elif model.startswith("bytedance-seed/"):
        text = f"{GIRL_DESC if role == 'girl' else DAD_DESC} \"{text}\""
    return orlib.tts(text, out.with_name(out.name + ".x"), model=model, voice=voice,
                     instructions=instructions, label=label, price_per_char=price)


# --------------------------------------------------------------------------- audition

JUDGE_PROMPT = """You are auditioning text-to-speech voices for a realistic fake phone call app in India.
Role: {role_desc}
Intended words: "{text}"

Listen and reply with JSON only:
{{"transcript": "<what you actually hear, in the script it is spoken>",
  "spoke_extra": <true if it read out any stage direction / description / words not in the intended text>,
  "indian_accent": <1-10, how authentically Indian (Delhi/North Indian) the accent is>,
  "hindi_pronunciation": <1-10, Hindi words, numbers and code-switching sound native>,
  "naturalness": <1-10, sounds like a real person on a call, not a narrator or robot>,
  "role_fit": <1-10, matches the role's age, gender and warmth>,
  "notes": "<one short sentence>"}}"""

ROLE_DESC = {"girl": "a young woman (20s) from Delhi talking casually to her father in Hinglish",
             "dad": "her father, late 50s, deep warm heavier voice, talking in Hinglish"}


def judge(path: Path, role: str, text: str) -> dict:
    raw = orlib.chat([{"role": "user", "content": [
        {"type": "text", "text": JUDGE_PROMPT.format(role_desc=ROLE_DESC[role], text=text)},
        orlib.audio_part(path)]}], model=JUDGE, label=f"judge {path.name}", estimate_usd=0.003,
        temperature=0)
    m = re.search(r"\{.*\}", raw, re.S)
    return json.loads(m.group(0)) if m else {"notes": raw[:200]}


def audition() -> list[dict]:
    jobs = [(model, voice, role) for model, (_, roles) in CANDIDATES.items()
            for role, voices in roles.items() for voice in voices]

    def run(job):
        model, voice, role = job
        line = AUDITION_LINES[role]
        out = OUT / "audition" / f"{role}__{slug(model)}__{slug(voice)}"
        try:
            r = synth(model, voice, role, line["text"], out, f"audition {role}")
            score = judge(r["path"], role, line["text"])
            return {"model": model, "voice": voice, "role": role, "file": str(r["path"].relative_to(OUT)),
                    "latency_s": r["latency_s"], **score}
        except Exception as e:  # keep going; one provider failing shouldn't stop the audition
            return {"model": model, "voice": voice, "role": role, "error": str(e)[:300]}

    results_path = OUT / "audition" / "results.json"
    old = {(r["model"], r["voice"], r["role"]): r for r in json.loads(results_path.read_text())
           if "error" not in r} if results_path.exists() else {}
    todo = [j for j in jobs if j not in old]
    with ThreadPoolExecutor(6) as pool:
        fresh = list(pool.map(run, todo))
    results = list(old.values()) + fresh
    results.sort(key=lambda r: (r["role"], -score_of(r)))
    results_path.parent.mkdir(parents=True, exist_ok=True)
    results_path.write_text(json.dumps(results, ensure_ascii=False, indent=1))
    for r in results:
        if "error" in r:
            print(f"  ERR {r['role']:4} {r['model']} {r['voice']}: {r['error'][:120]}")
        else:
            print(f"  {score_of(r):4.1f} {r['role']:4} {r['model']:36} {str(r['voice']):34} "
                  f"lat={r['latency_s']} extra={r.get('spoke_extra')} | {r.get('notes', '')[:90]}")
    return results


def score_of(r: dict) -> float:
    keys = ("indian_accent", "hindi_pronunciation", "naturalness", "role_fit")
    if "error" in r or not all(isinstance(r.get(k), (int, float)) for k in keys):
        return -1
    return sum(r[k] for k in keys) / 4 - (5 if r.get("spoke_extra") else 0)


def best_voices() -> dict[str, dict[str, str]]:
    results = json.loads((OUT / "audition" / "results.json").read_text())
    best: dict[str, dict[str, str]] = {}
    for model in SCENE_MODELS:
        for role in ("girl", "dad"):
            ranked = sorted((r for r in results if r["model"] == model and r["role"] == role
                             and "error" not in r), key=score_of)
            if ranked:
                best.setdefault(model, {})[role] = ranked[-1]["voice"]
    return best


# --------------------------------------------------------------------------- ambience + scenes

def ambience() -> None:
    def run(item):
        name, prompt = item
        out = OUT / "ambience" / name
        if not any(out.parent.glob(name + ".*")):
            orlib.tts(prompt, out.with_name(name + ".x"), model="bytedance-seed/seed-audio-1-0",
                      label=f"ambience {name}", price_per_char=0.0003)
        print("  ambience", name, "ok")
    with ThreadPoolExecutor(3) as pool:
        list(pool.map(run, AMBIENCE.items()))


def scenes() -> None:
    best = best_voices()
    (OUT / "casts.json").write_text(json.dumps(best, indent=1))
    jobs = [(model, cast, scene, i, line) for model, cast in best.items() if len(cast) == 2
            for scene in SCENES for i, line in enumerate(scene["lines"])]

    def run(job):
        model, cast, scene, i, line = job
        out = OUT / "lines" / slug(model) / f"{scene['id']}_{i:02d}_{line['who']}"
        try:
            synth(model, cast[line["who"]], line["who"], line["text"], out, f"scene {scene['id']}")
        except Exception as e:
            print(f"  ERR {model} {scene['id']} {i}: {str(e)[:150]}")
    with ThreadPoolExecutor(6) as pool:
        list(pool.map(run, jobs))
    print("  casts:", json.dumps(best, indent=1))


# --------------------------------------------------------------------------- mix

def load(path: Path) -> np.ndarray:
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(pcm, dtype=np.float32).copy()


def trim(x: np.ndarray, thresh: float = 0.01) -> np.ndarray:
    idx = np.where(np.abs(x) > thresh)[0]
    return x[max(0, idx[0] - 1200): idx[-1] + 2400] if len(idx) else x


def rms_norm(x: np.ndarray, target_db: float) -> np.ndarray:
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    return x * (10 ** (target_db / 20) / rms)


def bed(name: str, n: int, db: float) -> np.ndarray:
    src = next((OUT / "ambience").glob(name + ".*"), None)
    if not src:
        return np.zeros(n, dtype=np.float32)
    x = load(src)
    x = np.tile(x, n // len(x) + 1)[:n]
    return rms_norm(x, db)


def phone_band(x: np.ndarray) -> np.ndarray:
    """Narrowband call: 300-3400 Hz, 8 kHz resample, light compression and a touch of line hiss."""
    p = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
         "-af", "highpass=f=300,lowpass=f=3400,aresample=8000,acompressor=threshold=0.1:ratio=3,aresample=24000",
         "-f", "f32le", "-"], input=x.astype(np.float32).tobytes(), capture_output=True, check=True).stdout
    y = np.frombuffer(p, dtype=np.float32).copy()[: len(x)]
    y = np.pad(y, (0, len(x) - len(y)))
    return y + np.random.default_rng(0).normal(0, 0.0015, len(y)).astype(np.float32)


def mix_scene(model: str, scene: dict) -> Path | None:
    folder = OUT / "lines" / slug(model)
    clips = []
    for i, line in enumerate(scene["lines"]):
        f = next(folder.glob(f"{scene['id']}_{i:02d}_{line['who']}.*"), None)
        if not f:
            return None
        clips.append((line["who"], line["gap"], load(f)))
    return mix_scene_custom(clips, scene, OUT / "mix" / f"{scene['id']}__{slug(model)}.mp3")


def mix_scene_custom(clips: list[tuple[str, float, np.ndarray]], scene: dict, out: Path) -> Path:
    """clips = (who, silence before it in seconds, raw audio). Dad goes through the phone band."""
    clips = [(who, gap, rms_norm(trim(x), -20)) for who, gap, x in clips]
    total = int(sum(gap * SR + len(c) for _, gap, c in clips) + 1.0 * SR)
    near, far = np.zeros(total, np.float32), np.zeros(total, np.float32)
    t = int(0.5 * SR)
    for who, gap, c in clips:
        t += int(gap * SR)
        (near if who == "girl" else far)[t: t + len(c)] += c
        t += len(c)
    far = phone_band(far + bed(scene["far"], total, -42)) * 0.9
    near = near + bed(scene["near"], total, -34)
    y = near + far
    y = y / max(1.0, np.abs(y).max() / 0.95)
    out.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-b:a", "96k", str(out)], input=y.astype(np.float32).tobytes(), check=True)
    return out


def mix() -> None:
    for model in json.loads((OUT / "casts.json").read_text()):
        for scene in SCENES:
            out = mix_scene(model, scene)
            print("  mix", out.relative_to(OUT) if out else f"skipped {model} {scene['id']} (missing lines)")


# --------------------------------------------------------------------------- page

def page() -> None:
    casts = json.loads((OUT / "casts.json").read_text()) if (OUT / "casts.json").exists() else {}
    results = json.loads((OUT / "audition" / "results.json").read_text())
    h = ["<!doctype html><meta charset=utf-8><title>phoney voice lab</title>",
         "<style>body{font:14px system-ui;max-width:1100px;margin:2em auto;padding:0 1em}"
         "td,th{padding:4px 8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}"
         "audio{height:30px;width:260px}.s{font-weight:600}</style>",
         "<h1>phoney voice lab</h1><h2>Full calls</h2>",
         "<p>Dad is phone-band filtered with a faint TV room behind him; the girl has cab or street ambience.</p>"]
    for scene in SCENES:
        h.append(f"<h3>{html.escape(scene['title'])}</h3><details><summary>transcript</summary><ol>")
        h += [f"<li><b>{l['who']}</b>: {html.escape(l['roman'])}</li>" for l in scene["lines"]]
        h.append("</ol></details><table>")
        for model, cast in casts.items():
            f = OUT / "mix" / f"{scene['id']}__{slug(model)}.mp3"
            if f.exists():
                h.append(f"<tr><td>{model}<br><small>girl {cast['girl']}, dad {cast['dad']}</small></td>"
                         f"<td><audio controls preload=none src='{f.relative_to(OUT)}'></audio></td></tr>")
        h.append("</table>")
    for role in ("girl", "dad"):
        line = AUDITION_LINES[role]
        h.append(f"<h2>Audition: {role}</h2><p><i>{html.escape(line['roman'])}</i></p><table>"
                 "<tr><th>score</th><th>model / voice</th><th></th><th>accent</th><th>hindi</th>"
                 "<th>natural</th><th>fit</th><th>latency</th><th>judge notes</th></tr>")
        for r in sorted((r for r in results if r["role"] == role), key=lambda r: -score_of(r)):
            if "error" in r:
                h.append(f"<tr><td>err</td><td>{r['model']}<br>{r['voice']}</td><td colspan=7>"
                         f"{html.escape(r['error'][:150])}</td></tr>")
                continue
            h.append(f"<tr><td class=s>{score_of(r):.1f}</td><td>{r['model']}<br><small>{r['voice']}</small></td>"
                     f"<td><audio controls preload=none src='{r['file']}'></audio></td>"
                     + "".join(f"<td>{r.get(k)}</td>" for k in
                               ("indian_accent", "hindi_pronunciation", "naturalness", "role_fit"))
                     + f"<td>{r.get('latency_s') or ''}</td><td>{html.escape(str(r.get('notes', '')))}"
                       f"{' <b>(spoke extra words)</b>' if r.get('spoke_extra') else ''}</td></tr>")
        h.append("</table>")
    (OUT / "index.html").write_text("\n".join(h))
    print("  page", OUT / "index.html")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "all"
    stages = {"audition": audition, "ambience": ambience, "scenes": scenes, "mix": mix, "page": page}
    for name in (list(stages) if stage == "all" else [stage]):
        print(f"== {name}")
        stages[name]()
    print(f"spent so far: ${orlib.reconcile():.3f} (ledger: sim/ledger.jsonl)")
