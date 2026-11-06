# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy"]
# ///
"""Cast the other family voices (mom, sister, brother) with the v2 judge.

  uv run sim/roles.py calibrate          # known-age voices, judged twice: does est_age separate them?
  uv run sim/roles.py audition mom       # render the role line for every candidate, judge, rank
Outputs sim/out/roles/<role>/*.wav and sim/out/roles/<role>.json (shown on the lab page).
"""

from __future__ import annotations

import base64
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

import orlib
from judge import ROLES, judge

OUT = orlib.SIM / "out" / "roles"
SARVAM = "https://api.sarvam.ai/text-to-speech"
SMALLEST = "https://api.india.smallest.ai/waves/v1"


def synth(provider: str, voice: str, text: str, out: Path) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    if out.exists():
        return out
    if provider == "sarvam":
        model, speaker = voice.split(" ", 1)
        r = requests.post(SARVAM, headers={"api-subscription-key": orlib._env("SARVAM_API_KEY")}, timeout=60,
                          json={"text": text, "target_language_code": "hi-IN", "model": model, "speaker": speaker,
                                "speech_sample_rate": 24000})
        r.raise_for_status()
        out.write_bytes(base64.b64decode("".join(r.json()["audios"])))
    elif provider == "smallest":
        model, vid = voice.split(" ", 1)
        r = requests.post(f"{SMALLEST}/tts", timeout=60, json={
            "text": text, "voice_id": vid, "model": model, "language": "hi", "sample_rate": 24000,
            "output_format": "wav"}, headers={"Authorization": f"Bearer {orlib._env('SMALLEST_API_KEY')}"})
        r.raise_for_status()
        out.write_bytes(r.content)
    elif provider == "gemini":
        name, _, style = voice.partition(" | ")
        return orlib.tts(text, out.with_suffix(""), model="google/gemini-3.8-flash-tts", voice=name,
                         instructions=style or None, label="roles", price_per_char=0.00006)["path"]
    return out


def fname(provider: str, voice: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{provider} {voice.split(' | ')[0]}".lower()).strip("-") + ".wav"


CALIBRATION = [  # (provider, voice, what we believe)
    ("sarvam", "bulbul:v4-flash girish_hi_devotional", "older man"),
    ("sarvam", "bulbul:v4-flash sumit_hi_conversational", "older man"),
    ("sarvam", "bulbul:v4-flash ratan_hi_latenight_warm", "older man"),
    ("smallest", "lightning_v3.1 kartik", "young man (tagged young)"),
    ("smallest", "lightning_v3.1_pro rakesh", "young man (tagged young)"),
    ("gemini", "Sulafat | young woman from Delhi, casual phone call, natural Indian accent", "young woman, 20s"),
]


def calibrate():
    line = ROLES["dad"]["line"]
    for provider, voice, belief in CALIBRATION:
        f = synth(provider, voice, line, OUT / "calibration" / fname(provider, voice))
        runs = [judge(f, "dad") for _ in range(2)]
        ages = [r.get("est_age") for r in runs]
        print(f"  {belief:26} {provider:8} {voice.split(' | ')[0]:42} est {ages} "
              f"{runs[0].get('est_gender')} accent {[r.get('accent') for r in runs]} "
              f"score {[r['score'] for r in runs]} | {runs[0].get('age_cues', '')[:60]}")


def candidates(role: str) -> list[tuple[str, str]]:
    want = ROLES[role]["gender"]
    sarvam_f = ["ritu_hi_conversation", "roopa_hi_conversational", "simran_hi_conversation", "shalini_hi_companion",
                "sanchita_hi_assistant", "aparna_hi_customer", "kavya_hi_conversational", "ishita_hi_social",
                "suman_hi_companion", "suhani_hi_social", "shreya_hi_conversational", "shruti_hi_edtech",
                "shilpa_hi_narration", "sarika_hi_conversation", "aarti_hi_customer", "chaitra_hi_customer",
                "suchitra_hi_ecomm", "priya_hi_recovery", "roopa_hi_narration", "ritu_hi_customer_warm",
                "ishita_enhi_companion", "shalini_enhi_companion", "sanchita_enhi_companion", "simran_enhi_companion"]
    sarvam_m = ["aayan_hi_conversational", "kabir_hi_conversational", "manan_hi_conversational", "rahul_hi_conversational",
                "mohit_hi_conversational", "rehan_hi_social", "chirag_hi_social", "aryaman_hi_ads", "mukul_hi_ads",
                "shubh_enhi_companion", "aditya_hi_conversational", "amit_hi_conversational",
                "ashutosh_hi_conversational", "mani_hi_conversational", "sumit_hi_conversational"]
    out = [("sarvam", f"bulbul:v4-flash {s}") for s in (sarvam_f if want == "female" else sarvam_m)]
    out += [("sarvam", f"bulbul:v3 {s}") for s in
            (["ritu", "priya", "neha", "pooja", "simran", "kavya", "ishita", "shreya", "roopa", "tanya", "shruti",
              "suhani", "kavitha", "rupali"] if want == "female" else
             ["rahul", "rohan", "amit", "dev", "varun", "manan", "sumit", "kabir", "aayan", "advait", "tarun",
              "sunny", "mohit", "rehan", "soham"])]
    try:
        r = requests.get(f"{SMALLEST}/lightning-v3.1/get_voices", timeout=30,
                         headers={"Authorization": f"Bearer {orlib._env('SMALLEST_API_KEY')}"})
        for v in r.json().get("voices", []):
            t = v.get("tags", {})
            if t.get("accent") == "indian" and "hindi" in t.get("language", []) and t.get("gender") == want:
                young = t.get("age", "").lower() == "young"
                if (role in ("mom", "dad")) != young:
                    out.append(("smallest", f"lightning_v3.1 {v['voiceId']}"))
    except Exception as e:
        print("  smallest voices unavailable:", e)
    return out


def audition(role: str):
    line = ROLES[role]["line"]
    folder = OUT / role
    results_path = OUT / f"{role}.json"
    done = {(r["provider"], r["voice"]): r for r in json.loads(results_path.read_text())} if results_path.exists() else {}

    def run(c):
        provider, voice = c
        if c in done:
            return done[c]
        try:
            f = synth(provider, voice, line, folder / fname(provider, voice))
            r = judge(f, role)
            return {"provider": provider, "voice": voice, "file": str(f.relative_to(orlib.SIM / "out")), **r}
        except Exception as e:
            return {"provider": provider, "voice": voice, "error": str(e)[:200]}

    cands = candidates(role)
    print(f"  {role}: {len(cands)} candidates")
    with ThreadPoolExecutor(6) as pool:
        rows = list(pool.map(run, cands))
    rows.sort(key=lambda r: -r.get("score", -1))
    results_path.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    for r in rows[:15]:
        if "error" in r:
            continue
        print(f"  {r['score']:3} {r['provider']:8} {r['voice']:42} {r.get('est_gender')} {r.get('est_age')} "
              f"acc {r.get('accent')} hard {r.get('hard_bits')} nat {r.get('naturalness')} {r.get('sounds_like')}")
    print(f"  errors: {sum('error' in r for r in rows)}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "calibrate"
    calibrate() if stage == "calibrate" else audition(sys.argv[2])
