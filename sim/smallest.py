# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy"]
# ///
"""Smallest AI (Lightning) audition for the dad voice, judged like the OpenRouter voices.

  uv run sim/smallest.py voices        # list Indian / Hindi voices
  uv run sim/smallest.py audition      # dad lines x candidate voices x models, timed + judged
Key: SMALLEST_API_KEY in phoney/.env or ../.env (read in code, never printed).
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

import orlib

# Pinned to Mumbai: from the US the default host routes to Oregon, where lightning_v3.1 rejects
# every language with LANGUAGE_NOT_ENABLED_IN_REGION.
BASE = "https://api.india.smallest.ai/waves/v1"
OUT = orlib.SIM / "out" / "smallest"
MODELS = ["lightning_v3.1", "lightning_v3.1_pro"]
DAD_LINES = json.loads((orlib.SIM / "scenes.json").read_text())["scenes"][0]["lines"]
DAD_TEXT = [l["text"] for l in DAD_LINES if l["who"] == "dad"]


def headers() -> dict:
    return {"Authorization": f"Bearer {orlib._env('SMALLEST_API_KEY')}", "Content-Type": "application/json"}


def voices(model: str = "lightning-v3.1") -> list[dict]:
    r = requests.get(f"{BASE}/{model}/get_voices", headers=headers(), timeout=30)
    r.raise_for_status()
    return r.json().get("voices", [])


def list_voices():
    for model in ("lightning-v3.1", "lightning-v3.1-pro"):
        try:
            vs = voices(model)
        except Exception as e:
            print(f"== {model}: {e}")
            continue
        indian = [v for v in vs if v.get("tags", {}).get("accent") == "indian"
                  and "hindi" in v.get("tags", {}).get("language", []) and v["tags"].get("gender") == "male"]
        print(f"== {model}: {len(vs)} voices, {len(indian)} Indian male Hindi voices")
        for v in sorted(indian, key=lambda v: v["tags"].get("age", "")):
            t = v["tags"]
            print(f"  {v['voiceId']:16} {t.get('age', ''):12} {', '.join(t.get('usecases', []))[:50]:52} "
                  f"{', '.join(t.get('emotions', [])[:4])}")


def tts(text: str, voice: str, model: str, out: Path) -> dict:
    t0 = time.time()
    ttfb, data = None, bytearray()
    body = {"text": text, "voice_id": voice, "model": model, "language": "hi", "sample_rate": 24000,
            "output_format": "wav"}
    with requests.post(f"{BASE}/tts", headers=headers(), json=body, stream=True, timeout=60) as r:
        if not r.ok:
            raise RuntimeError(f"{model} {voice}: HTTP {r.status_code} {r.text[:200]}")
        for chunk in r.iter_content(2048):
            ttfb = ttfb or time.time() - t0
            data += chunk
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(bytes(data))
    return {"ttfb": round(ttfb, 2), "total": round(time.time() - t0, 2), "path": out}


JUDGE = """You are auditioning text-to-speech voices for a realistic fake phone call app in India.
Role: her father, late 50s, deep warm heavier voice, North Indian, talking Hinglish on the phone.
Intended words: "{text}"
Reply with JSON only: {{"transcript": "...", "spoke_extra": true/false, "indian_accent": 1-10,
"hindi_pronunciation": 1-10, "naturalness": 1-10, "role_fit": 1-10, "notes": "one short sentence"}}"""


def judge(path: Path, text: str) -> dict:
    raw = orlib.chat([{"role": "user", "content": [{"type": "text", "text": JUDGE.format(text=text)},
                                                   orlib.audio_part(path)]}],
                     model="google/gemini-3.8-flash", label="judge smallest", estimate_usd=0.003, temperature=0)
    m = re.search(r"\{.*\}", raw, re.S)
    return json.loads(m.group(0)) if m else {"notes": raw[:200]}


def audition(candidates: list[str]):
    rows = []
    line = DAD_TEXT[1]  # the "location share aa gaya" line, same as the OpenRouter audition
    for pair in candidates:
        model, voice = pair.split(":") if ":" in pair else (MODELS[0], pair)
        if True:
            try:
                r = tts(line, voice, model, OUT / f"{model}__{voice}.wav")
            except Exception as e:
                print(f"  ERR {e}")
                continue
            s = judge(r["path"], line)
            score = sum(s.get(k, 0) for k in ("indian_accent", "hindi_pronunciation", "naturalness", "role_fit")) / 4
            rows.append({"model": model, "voice": voice, "ttfb": r["ttfb"], "total": r["total"], "score": score,
                         **s, "path": str(r["path"])})
            print(f"  {score:4.1f} {model:20} {voice:14} first byte {r['ttfb']:.2f}s total {r['total']:.2f}s | "
                  f"{s.get('notes', '')[:90]}")
    (OUT / "results.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "voices"
    if stage == "voices":
        list_voices()
    else:
        audition(sys.argv[2:])
