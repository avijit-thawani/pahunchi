"""Minimal OpenRouter client for the voice lab: TTS, audio-judge chat, cost ledger.

The key is read from phoney/.env or the shared learn/.env and never printed.
Every paid call is checked against BUDGET_USD using the ledger's running total.
"""

from __future__ import annotations

import base64
import json
import os
import time
import wave
from pathlib import Path

import requests

SIM = Path(__file__).resolve().parent
ROOT = SIM.parent
LEDGER = SIM / "ledger.jsonl"
BASE = "https://openrouter.ai/api/v1"
BUDGET_USD = float(os.environ.get("PHONEY_BUDGET_USD", "8"))


def _env(name: str) -> str:
    if os.environ.get(name):
        return os.environ[name]
    for path in (ROOT / ".env", ROOT.parent / ".env"):
        if path.exists():
            for line in path.read_text().splitlines():
                key, sep, value = line.strip().removeprefix("export ").partition("=")
                if sep and key.strip() == name and value.strip():
                    return value.strip().strip("'\"")
    raise SystemExit(f"{name} not set (phoney/.env or ../.env)")


def _headers(json_body: bool = True) -> dict[str, str]:
    h = {"Authorization": f"Bearer {_env('OPENROUTER_API_KEY')}", "X-Title": "phoney"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def ledger_rows() -> list[dict]:
    if not LEDGER.exists():
        return []
    return [json.loads(l) for l in LEDGER.read_text().splitlines() if l.strip()]


def spent() -> float:
    return sum((r.get("cost_usd") or r.get("estimate_usd") or 0) for r in ledger_rows())


def _guard(estimate: float, label: str) -> None:
    total = spent()
    if total + estimate > BUDGET_USD:
        raise SystemExit(f"budget: ${total:.3f} spent + ${estimate:.3f} for {label} > ${BUDGET_USD}")


def _record(**row) -> None:
    row["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with LEDGER.open("a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def tts(text: str, out: Path, *, model: str, voice: str | None = None,
        instructions: str | None = None, label: str = "", price_per_char: float = 0.0001) -> dict:
    """Synthesize one line. Returns {path, latency_s, generation_id}. Writes WAV for pcm, MP3 otherwise."""
    estimate = max(0.001, price_per_char * len(text))
    _guard(estimate, label)
    fmt = "mp3" if model.startswith(("minimax/", "bytedance-seed/", "elevenlabs/", "fish-audio/", "x-ai/")) else "pcm"
    body: dict = {"model": model, "input": text, "response_format": fmt}
    if voice:
        body["voice"] = voice
    if instructions:
        body["instructions"] = instructions
    t0 = time.time()
    r = requests.post(f"{BASE}/audio/speech", headers=_headers(), json=body, timeout=300)
    latency = round(time.time() - t0, 2)
    if not r.ok or not r.content:
        _record(kind="tts", model=model, voice=voice, label=label, status="error",
                estimate_usd=0, error=r.text[:300], latency_s=latency)
        raise RuntimeError(f"tts {label} {model}: HTTP {r.status_code}: {r.text[:300]}")
    out = out.resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    ctype = r.headers.get("Content-Type", "")
    if fmt == "pcm" and "mpeg" not in ctype:
        out = out.with_suffix(".wav")
        with wave.open(str(out), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(r.content)
    else:
        out = out.with_suffix(".mp3")
        out.write_bytes(r.content)
    gen_id = r.headers.get("X-Generation-Id")
    _record(kind="tts", model=model, voice=voice, label=label, status="ok", chars=len(text),
            estimate_usd=round(estimate, 5), cost_usd=None, generation_id=gen_id,
            latency_s=latency, out=str(out.relative_to(ROOT)))
    return {"path": out, "latency_s": latency, "generation_id": gen_id}


def reconcile() -> float:
    """Replace estimates with billed cost for TTS rows (cost arrives via /generation)."""
    rows = ledger_rows()
    for row in rows:
        if row.get("cost_usd") is None and row.get("generation_id"):
            for i in range(3):
                r = requests.get(f"{BASE}/generation", params={"id": row["generation_id"]},
                                 headers=_headers(False), timeout=30)
                cost = (r.json().get("data") or {}).get("total_cost") if r.ok else None
                if cost is not None:
                    row["cost_usd"] = float(cost)
                    break
                time.sleep(1.5 * (i + 1))
    LEDGER.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    return spent()


def chat(messages: list[dict], *, model: str, label: str = "", estimate_usd: float = 0.01, **kw) -> str:
    _guard(estimate_usd, label)
    t0 = time.time()
    r = requests.post(f"{BASE}/chat/completions", headers=_headers(),
                      json={"model": model, "messages": messages, **kw}, timeout=300)
    latency = round(time.time() - t0, 2)
    if not r.ok:
        raise RuntimeError(f"chat {label}: HTTP {r.status_code}: {r.text[:300]}")
    payload = r.json()
    usage = payload.get("usage") or {}
    _record(kind="chat", model=model, label=label, status="ok", estimate_usd=estimate_usd,
            cost_usd=usage.get("cost"), latency_s=latency)
    return payload["choices"][0]["message"].get("content") or ""


def audio_part(path: Path) -> dict:
    return {"type": "input_audio",
            "input_audio": {"data": base64.b64encode(path.read_bytes()).decode(), "format": path.suffix.lstrip(".")}}
