"""Audio judge v2: estimates gender and age from the voice, rates Indian accent and the hard bits
(हम्म, pauses, laughs, numbers), and folds in how well age/gender fit the role.

The v1 judge (lab.py, smallest.py) gave most decent voices 9/10. This one asks for observations
first (age in years, accent region, what it sounds like) and computes the score itself.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import orlib

MODEL = "google/gemini-3.8-flash"
ROLES = json.loads((orlib.SIM / "roles.json").read_text())["roles"]

PROMPT = """You are a casting director in Mumbai with a trained ear for Indian voices, auditioning text-to-speech
voices for a fake phone call app. Be critical; do not be polite.

Intended words: "{line}"

1. From the VOICE ALONE (pitch, resonance, breathiness, vocal fry, pace), estimate the speaker's apparent gender
   and age in years. Ignore what the words say about the speaker.
2. Indian accent, as a North Indian listener would hear it: native Hindi speaker (Delhi/UP), South Indian,
   other Indian, NRI, or non-Indian. Cues: retroflex ट/ड vs dental त/द, aspiration (ख, घ, थ), v/w, vowel length,
   Hindi sentence intonation, English loanwords (cab, location, traffic) said the Indian way.
3. Hard bits: does "हम्म" sound like a natural hum (not read out as a word)? Are the pauses (… and —) natural?
   Is "हाहा" a real laugh or read out? Are numbers and the plate natural?
4. Overall, does it sound like a real person on a phone call, or a narrator, ad, IVR menu or robot?

Reply with JSON only:
{{"transcript": "...", "est_gender": "female" or "male", "est_age": <integer years>,
  "age_cues": "<short: what in the voice suggests that age>",
  "accent_region": "north indian" | "south indian" | "other indian" | "nri" | "non-indian",
  "accent": <0-100>, "hard_bits": <0-100>, "naturalness": <0-100>,
  "sounds_like": "phone call" | "narrator" | "ad" | "ivr" | "robotic",
  "issues": "<the single worst moment, quote the words>"}}"""


def age_fit(est: int | None, lo: int, hi: int) -> float:
    """1.0 inside the target range, falling to 0 at 15 years outside it."""
    if not isinstance(est, (int, float)):
        return 0.5
    gap = max(lo - est, est - hi, 0)
    return max(0.0, 1 - gap / 15)


def judge(path: Path, role: str, line: str | None = None, runs: int = 2) -> dict:
    """Average `runs` judgements: single runs swing by 20 points on the same clip."""
    rs = [_judge_once(path, role, line) for _ in range(runs)]
    out = dict(rs[0])
    for k in ("est_age", "accent", "hard_bits", "naturalness", "age_fit", "score"):
        xs = [r[k] for r in rs if isinstance(r.get(k), (int, float))]
        if xs:
            out[k] = round(sum(xs) / len(xs), 2 if k == "age_fit" else None)
    genders = [r.get("est_gender") for r in rs]
    out["est_gender"] = max(set(genders), key=genders.count)
    out["runs"] = [{k: r.get(k) for k in ("est_age", "est_gender", "score")} for r in rs]
    return out


def _judge_once(path: Path, role: str, line: str | None = None) -> dict:
    spec = ROLES[role]
    raw = orlib.chat([{"role": "user", "content": [
        {"type": "text", "text": PROMPT.format(line=line or spec["line"])}, orlib.audio_part(path)]}],
        model=MODEL, label=f"judge2 {role}", estimate_usd=0.004, temperature=0)
    m = re.search(r"\{.*\}", raw, re.S)
    r = json.loads(m.group(0)) if m else {"issues": raw[:200]}
    quality = sum(r.get(k, 0) for k in ("accent", "hard_bits", "naturalness")) / 3
    gender_ok = r.get("est_gender") == spec["gender"]
    fit = age_fit(r.get("est_age"), *spec["age"])
    accent_ok = 1.0 if r.get("accent_region") == "north indian" else 0.85
    call_ok = 1.0 if r.get("sounds_like") == "phone call" else 0.9
    r["age_fit"] = round(fit, 2)
    r["score"] = round(quality * fit * accent_ok * call_ok * (1.0 if gender_ok else 0.3))
    return r
