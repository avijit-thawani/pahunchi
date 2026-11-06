# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy"]
# ///
"""Sarvam Bulbul text-to-speech over plain HTTP (no SDK).

  uv run sim/sarvam.py first                 # one call, prints status/latency/bytes, saves a wav
  uv run sim/sarvam.py audition [model:speaker ...]   # dad line per voice, timed + judged
Key: SARVAM_API_KEY in phoney/.env or ../.env (read in code, never printed).
Docs: https://docs.sarvam.ai/api/api-guides-tutorials/models/bulbul.md
"""

from __future__ import annotations

import base64
import json
import sys
import time
from pathlib import Path

import requests

import orlib
from smallest import judge

URL = "https://api.sarvam.ai/text-to-speech"
OUT = orlib.SIM / "out" / "sarvam"
LINE = "हम्म, लिख लिया। हाँ, location share आ गया है। तो कितनी देर में पहुँच जाओगी?"

DEFAULT_CANDIDATES = [
    "bulbul:v4-flash:ratan_hi_latenight_warm", "bulbul:v4-flash:ratan_hi_documentary",
    "bulbul:v4-flash:ashok_hi_news", "bulbul:v4-flash:ashok_hi_character",
    "bulbul:v4-flash:anand_hi_documentary", "bulbul:v4-flash:mahesh_hi_documentary",
    "bulbul:v4-flash:girish_hi_devotional", "bulbul:v4-flash:nachiket_hi_devotional",
    "bulbul:v4-flash:amit_hi_conversational", "bulbul:v4-flash:kabir_hi_conversational",
    "bulbul:v4-flash:sumit_hi_conversational", "bulbul:v4-flash:rahul_hi_conversational",
    "bulbul:v4-flash:aditya_hi_conversational", "bulbul:v4-flash:shubh_enhi_companion",
    "bulbul:v3:anand", "bulbul:v3:ratan", "bulbul:v3:vijay", "bulbul:v3:aditya", "bulbul:v3:shubh",
]


def tts(text: str, model: str, speaker: str, out: Path) -> dict:
    body = {"text": text, "target_language_code": "hi-IN", "model": model, "speaker": speaker,
            "speech_sample_rate": 24000}
    t0 = time.time()
    r = requests.post(URL, headers={"api-subscription-key": orlib._env("SARVAM_API_KEY")}, json=body, timeout=60)
    dt = time.time() - t0
    if not r.ok:
        raise RuntimeError(f"{model} {speaker}: HTTP {r.status_code} {r.text[:200]}")
    wav = base64.b64decode("".join(r.json()["audios"]))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(wav)
    return {"s": round(dt, 2), "bytes": len(wav), "path": out}


def stream_ttfb(text: str, model: str, speaker: str, codec: str = "mp3") -> dict:
    body = {"text": text, "target_language_code": "hi-IN", "model": model, "speaker": speaker,
            "speech_sample_rate": 24000, "output_audio_codec": codec}
    t0, ttfb, n = time.time(), None, 0
    with requests.post(URL + "/stream", headers={"api-subscription-key": orlib._env("SARVAM_API_KEY")},
                       json=body, stream=True, timeout=60) as r:
        if not r.ok:
            raise RuntimeError(f"stream {speaker}: HTTP {r.status_code} {r.text[:200]}")
        for chunk in r.iter_content(1024):
            ttfb = ttfb or time.time() - t0
            n += len(chunk)
    return {"ttfb": round(ttfb, 2), "total": round(time.time() - t0, 2), "bytes": n}


def latency(candidates: list[str]):
    clause = "अच्छा, कौन सी गाड़ी है?"
    for c in candidates:
        model, speaker = c.rsplit(":", 1)
        for _ in range(2):
            for kind, text in (("clause", clause), ("line", LINE)):
                try:
                    r = stream_ttfb(text, model, speaker)
                    print(f"  {speaker:28} {kind:6} first byte {r['ttfb']:.2f}s total {r['total']:.2f}s")
                except Exception as e:
                    print(f"  ERR {str(e)[:150]}")


def first():
    r = tts(LINE, "bulbul:v4-flash", "ratan_hi_latenight_warm", OUT / "first.wav")
    print(f"ok: {r['bytes']} bytes of wav in {r['s']}s -> {r['path'].relative_to(orlib.ROOT)}")


def audition(candidates: list[str]):
    rows = []
    for c in candidates:
        model, speaker = c.rsplit(":", 1)
        try:
            r = tts(LINE, model, speaker, OUT / f"{model.replace(':', '-')}__{speaker}.wav")
        except Exception as e:
            print(f"  ERR {str(e)[:160]}")
            continue
        s = judge(r["path"], LINE)
        score = sum(s.get(k, 0) for k in ("indian_accent", "hindi_pronunciation", "naturalness", "role_fit")) / 4
        rows.append({"model": model, "speaker": speaker, "s": r["s"], "score": score, **s, "path": str(r["path"])})
        print(f"  {score:4.1f} {model:16} {speaker:28} {r['s']:.2f}s | {s.get('notes', '')[:90]}")
    (OUT / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "first"
    if stage == "first":
        first()
    elif stage == "latency":
        latency(sys.argv[2:])
    else:
        audition(sys.argv[2:] or DEFAULT_CANDIDATES)
