# /// script
# requires-python = ">=3.11"
# dependencies = ["requests", "numpy"]
# ///
"""Latency lab: how long from the end of her sentence to the first sound of his reply?

  uv run sim/latency.py tts        # time to first audio byte per TTS voice (does it stream?)
  uv run sim/latency.py stt        # transcription time per model on her clips
  uv run sim/latency.py llm        # streaming LLMs: time to first token / first clause, with replies
  uv run sim/latency.py audiollm   # LLMs that take her audio directly (no STT hop)
  uv run sim/latency.py s2s        # speech-to-speech models (gpt-audio): time to first audio
  uv run sim/latency.py live       # full pipelines run turn by turn, saving his audio
  uv run sim/latency.py render     # mixes with the measured gaps -> sim/out/latency/*.mp3
  uv run sim/latency.py report     # summary tables -> sim/out/latency/report.md
Results append to sim/out/latency/*.jsonl; turn detection is added as a fixed tail (see TAILS).
"""

from __future__ import annotations

import base64
import json
import re
import statistics
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import requests

import orlib
from lab import OUT, SCENES, load, mix_scene_custom, slug

LAT = OUT / "latency"
LAT.mkdir(parents=True, exist_ok=True)
LINES = OUT / "lines" / "google-gemini-3-8-flash-tts"   # her voice: Sulafat clips from the lab

# Turn detection = how long after she stops before we act. Added on top of every measurement.
TAILS = {"vad 800ms": 0.8, "vad 500ms": 0.5, "speculative 300ms": 0.3}

DAD_STYLE = "Indian father in his late fifties, deep, warm, unhurried, on the phone with his daughter"
TTS_CANDIDATES = [
    ("google/gemini-3.8-flash-tts", "Algenib", DAD_STYLE),
    ("google/gemini-3.8-flash-lite-tts", "Algenib", DAD_STYLE),
    ("microsoft/mai-voice-2.1", "hi-IN-Grant:MAI-Voice-2.1", None),
    ("microsoft/mai-voice-2.1-flash", "hi-IN-Arjun:MAI-Voice-2.1-Flash", None),
    ("x-ai/grok-voice-tts-1.0", "leo", None),
    ("elevenlabs/eleven-flash-v2.5", "brian", None),
    ("elevenlabs/eleven-v3", "brian", None),
    ("fish-audio/drama-3", None, "older Indian man, deep warm voice, phone call"),
]
STT_MODELS = ["openai/gpt-4o-mini-transcribe", "x-ai/grok-stt-1.0", "openai/whisper-large-v3-turbo",
              "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b"]
LLM_MODELS = ["google/gemini-3.5-flash-lite", "google/gemini-2.5-flash-lite", "openai/gpt-4.1-nano",
              "openai/gpt-4o-mini", "anthropic/claude-haiku-5.5", "meta-llama/llama-4-scout"]
AUDIO_LLMS = ["google/gemini-3.5-flash-lite", "google/gemini-2.5-flash-lite"]
S2S_MODELS = [("openai/gpt-audio-mini", "ash"), ("openai/gpt-audio", "ash")]
REASONING = {"google/gemini-3.5-flash-lite": {"effort": "minimal"}}

CLAUSE = re.compile(r"[.?!।]|,(?=\s)")


def system_prompt(language: str = "hinglish") -> str:
    js = ("import {systemPrompt} from './server/prompt.ts'; import {persona} from './shared/personas.ts';"
          f"process.stdout.write(systemPrompt(persona('dad'), 'Papa', '{language}'))")
    return subprocess.run(["node", "--input-type=module", "-e", js], cwd=orlib.ROOT,
                          capture_output=True, text=True, check=True).stdout


def girl_turns():
    """(scene, index, line, wav) for each of her lines, with the scripted lines before it."""
    for scene in SCENES:
        for i, line in enumerate(scene["lines"]):
            if line["who"] == "girl":
                yield scene, i, line, next(LINES.glob(f"{scene['id']}_{i:02d}_girl.*"))


def scripted_history(scene, upto: int) -> list[dict]:
    msgs = [{"role": "user", "content": "[call connected]"}, {"role": "assistant", "content": "हाँ बेटा, बोल।"}]
    for line in scene["lines"][:upto]:
        msgs.append({"role": "user" if line["who"] == "girl" else "assistant", "content": line["text"]})
    return msgs


def log(name: str, row: dict):
    with (LAT / f"{name}.jsonl").open("a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def rows(name: str) -> list[dict]:
    p = LAT / f"{name}.jsonl"
    return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []


# --------------------------------------------------------------------------- streaming primitives

def sse(body: dict, label: str, estimate: float = 0.003):
    """Yield (seconds since request, parsed chunk) from a streaming chat completion."""
    orlib._guard(estimate, label)
    t0 = time.time()
    body = {**body, "stream": True, "usage": {"include": True}}
    with requests.post(f"{orlib.BASE}/chat/completions", headers=orlib._headers(), json=body,
                       stream=True, timeout=120) as r:
        if not r.ok:
            raise RuntimeError(f"{label}: HTTP {r.status_code} {r.text[:300]}")
        cost = None
        for raw in r.iter_lines():
            if not raw or not raw.startswith(b"data: ") or raw == b"data: [DONE]":
                continue
            chunk = json.loads(raw[6:])
            if chunk.get("usage"):
                cost = chunk["usage"].get("cost")
            yield time.time() - t0, chunk
    orlib._record(kind="chat-stream", model=body["model"], label=label, status="ok",
                  estimate_usd=estimate, cost_usd=cost, latency_s=round(time.time() - t0, 2))


def stream_reply(model: str, messages: list[dict]) -> dict:
    """Stream an LLM reply; note first token, first speakable clause, and the end."""
    body = {"model": model, "messages": messages, "max_tokens": 120, "temperature": 0.8}
    if model in REASONING:
        body["reasoning"] = REASONING[model]
    text, first_tok, first_clause = "", None, None
    clause_text = ""
    for t, chunk in sse(body, f"llm {model}"):
        delta = (chunk.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
        if not delta:
            continue
        first_tok = first_tok or t
        text += delta
        if first_clause is None:
            m = CLAUSE.search(text, 12)
            if m or len(text) > 60:
                first_clause, clause_text = t, text[: m.end()] if m else text
    first_clause = first_clause or (t if text else None)
    return {"text": text.strip(), "ttft": first_tok, "first_clause": first_clause,
            "clause": (clause_text or text).strip(), "done": t}


CLONE_REF = LINES / "cab_night_03_dad.wav"   # Algenib, used as the voice reference for Fish cloning
CLONE_TEXT = "हम्म, लिख लिया। हाँ, location share आ गया है। तो कितनी देर में पहुँच जाओगी?"


def clone_reference() -> list[dict]:
    mp3 = LAT / "clone_ref.mp3"
    if not mp3.exists():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(CLONE_REF), "-ac", "1", "-ar", "16000",
                        "-b:a", "48k", str(mp3)], check=True)
    data = base64.b64encode(mp3.read_bytes()).decode()
    return [{"type": "input_audio", "input_audio": {"data": f"data:audio/mpeg;base64,{data}"}},
            {"type": "text", "text": CLONE_TEXT}]


def tts_stream(model: str, voice: str | None, style: str | None, text: str, out: Path | None = None,
               clone: bool = False) -> dict:
    fmt = "pcm" if model.startswith(("google/", "microsoft/", "elevenlabs/")) else "mp3"
    body = {"model": model, "input": text, "response_format": fmt}
    if voice:
        body["voice"] = voice
    if style:
        body["instructions"] = style
    if clone:
        body["input_references"] = clone_reference()
    orlib._guard(0.002, f"tts {model}")
    t0 = time.time()
    data, ttfb = bytearray(), None
    with requests.post(f"{orlib.BASE}/audio/speech", headers=orlib._headers(), json=body, stream=True,
                       timeout=120) as r:
        if not r.ok:
            raise RuntimeError(f"tts {model}: HTTP {r.status_code} {r.text[:200]}")
        gen = r.headers.get("X-Generation-Id")
        for chunk in r.iter_content(2048):
            ttfb = ttfb or time.time() - t0
            data += chunk
    total = time.time() - t0
    orlib._record(kind="tts", model=model, voice=voice, label="latency", status="ok", chars=len(text),
                  estimate_usd=0.002, cost_usd=None, generation_id=gen, latency_s=round(total, 2))
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        if fmt == "pcm":
            import wave
            with wave.open(str(out.with_suffix(".wav")), "wb") as w:
                w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000), w.writeframes(bytes(data))
            out = out.with_suffix(".wav")
        else:
            out = out.with_suffix(".mp3")
            out.write_bytes(bytes(data))
    return {"ttfb": ttfb, "total": total, "bytes": len(data), "path": str(out) if out else None}


def stt_once(model: str, wav: Path) -> dict:
    orlib._guard(0.001, f"stt {model}")
    t0 = time.time()
    r = requests.post(f"{orlib.BASE}/audio/transcriptions", headers=orlib._headers(), timeout=60, json={
        "model": model, "input_audio": {"data": base64.b64encode(wav.read_bytes()).decode(), "format": "wav"}})
    dt = time.time() - t0
    j = r.json() if r.ok else {}
    orlib._record(kind="stt", model=model, label="latency", status="ok" if r.ok else "error",
                  estimate_usd=0.001, cost_usd=(j.get("usage") or {}).get("cost"), latency_s=round(dt, 2))
    return {"s": dt, "text": j.get("text", f"ERR {r.status_code} {r.text[:100]}").strip()}


def s2s_once(model: str, voice: str, messages: list[dict], wav: Path, out: Path | None) -> dict:
    """Speech in, speech out. Past turns as text, her current turn as audio."""
    msgs = messages + [{"role": "user", "content": [{"type": "input_audio", "input_audio": {
        "data": base64.b64encode(wav.read_bytes()).decode(), "format": "wav"}}]}]
    body = {"model": model, "messages": msgs, "modalities": ["text", "audio"], "max_tokens": 400,
            "audio": {"voice": voice, "format": "pcm16"}}
    pcm, transcript, first_audio = bytearray(), "", None
    for t, chunk in sse(body, f"s2s {model}", estimate=0.03):
        audio = ((chunk.get("choices") or [{}])[0].get("delta") or {}).get("audio") or {}
        if audio.get("data"):
            first_audio = first_audio or t
            pcm += base64.b64decode(audio["data"])
        transcript += audio.get("transcript") or ""
    if out and pcm:
        import wave
        out.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(out.with_suffix(".wav")), "wb") as w:
            w.setnchannels(1), w.setsampwidth(2), w.setframerate(24000), w.writeframes(bytes(pcm))
    return {"first_audio": first_audio, "done": t, "text": transcript.strip(),
            "path": str(out.with_suffix(".wav")) if out and pcm else None}


# --------------------------------------------------------------------------- component benchmarks

TTS_TEXTS = {"clause": "अच्छा, कौन सी गाड़ी है?",
             "sentence": "अच्छा, ठीक है। cab का number क्या है? मैं line पे हूँ, तू आराम से बैठ।"}


def bench_tts(runs: int = 3):
    for _ in range(runs):
        for model, voice, style in TTS_CANDIDATES:
            for kind, text in TTS_TEXTS.items():
                try:
                    r = tts_stream(model, voice, style, text)
                    log("tts", {"model": model, "voice": voice, "kind": kind, **r})
                    print(f"  {model:34} {kind:8} first byte {r['ttfb']:.2f}s  total {r['total']:.2f}s")
                except Exception as e:
                    print(f"  ERR {model}: {str(e)[:150]}")


def bench_stt():
    for model in STT_MODELS:
        for scene, i, line, wav in girl_turns():
            try:
                r = stt_once(model, wav)
            except Exception as e:
                r = {"s": None, "text": f"ERR {e}"}
            log("stt", {"model": model, "clip": wav.name, "ref": line["roman"], **r})
            print(f"  {model:50} {r['s'] or 0:.2f}s  {r['text'][:60]}")


def bench_llm():
    sp = system_prompt()
    for model in LLM_MODELS:
        for scene, i, line, wav in girl_turns():
            msgs = [{"role": "system", "content": sp}] + scripted_history(scene, i + 1)
            try:
                r = stream_reply(model, msgs)
            except Exception as e:
                print(f"  ERR {model}: {str(e)[:150]}")
                continue
            log("llm", {"model": model, "scene": scene["id"], "i": i, "her": line["text"], **r})
            print(f"  {model:32} ttft {r['ttft'] or 0:.2f}s clause {r['first_clause'] or 0:.2f}s "
                  f"done {r['done']:.2f}s | {r['text'][:70]}")


def bench_audiollm():
    sp = system_prompt() + "\n\nHer latest turn arrives as audio; reply to what she says."
    for model in AUDIO_LLMS:
        for scene, i, line, wav in girl_turns():
            msgs = [{"role": "system", "content": sp}] + scripted_history(scene, i) + [{"role": "user", "content": [
                {"type": "input_audio", "input_audio": {"data": base64.b64encode(wav.read_bytes()).decode(),
                                                        "format": "wav"}}]}]
            try:
                r = stream_reply(model, msgs)
            except Exception as e:
                print(f"  ERR {model}: {str(e)[:150]}")
                continue
            log("audiollm", {"model": model, "scene": scene["id"], "i": i, "her": line["text"], **r})
            print(f"  {model:32} ttft {r['ttft'] or 0:.2f}s clause {r['first_clause'] or 0:.2f}s | {r['text'][:70]}")


S2S_STYLE = ("\n\nYou speak out loud with a natural North Indian accent: an Indian father in his late fifties, "
             "deep, warm, unhurried voice. Speak Hinglish (Hindi with everyday English words).")


def bench_s2s():
    sp = system_prompt() + S2S_STYLE
    for model, voice in S2S_MODELS:
        for scene, i, line, wav in girl_turns():
            msgs = [{"role": "system", "content": sp}] + scripted_history(scene, i)
            out = LAT / "s2s" / f"{slug(model)}_{scene['id']}_{i:02d}"
            try:
                r = s2s_once(model, voice, msgs, wav, out)
            except Exception as e:
                print(f"  ERR {model}: {str(e)[:200]}")
                continue
            log("s2s", {"model": model, "voice": voice, "scene": scene["id"], "i": i, **r})
            print(f"  {model:24} first audio {r['first_audio'] or 0:.2f}s done {r['done']:.2f}s | {r['text'][:70]}")


# --------------------------------------------------------------------------- live pipelines

STT, LLM = "openai/gpt-4o-mini-transcribe", "google/gemini-3.5-flash-lite"
PIPELINES = {
    "cascade-gemini-tts": dict(stt=STT, llm=LLM, tts=TTS_CANDIDATES[0]),
    "cascade-mai-grant": dict(stt=STT, llm=LLM, tts=TTS_CANDIDATES[2]),
    "cascade-eleven-flash": dict(stt=STT, llm=LLM, tts=TTS_CANDIDATES[5]),
    "cascade-fish-clone": dict(stt=STT, llm=LLM, tts=("fish-audio/drama-3", None, None), clone=True),
    "s2s-gpt-audio-mini": dict(s2s=S2S_MODELS[0]),
}


def live(only: list[str] | None = None):
    """Run each pipeline turn by turn on every scene. History = the pipeline's own replies."""
    sp = system_prompt()
    for name, cfg in PIPELINES.items():
        if only and name not in only:
            continue
        for scene in SCENES:
            msgs = [{"role": "system", "content": sp + (S2S_STYLE if "s2s" in cfg else "")},
                    {"role": "user", "content": "[call connected]"}, {"role": "assistant", "content": "हाँ बेटा, बोल।"}]
            for i, line in enumerate(scene["lines"]):
                if line["who"] != "girl":
                    continue
                wav = next(LINES.glob(f"{scene['id']}_{i:02d}_girl.*"))
                out = LAT / "live" / name / f"{scene['id']}_{i:02d}"
                row = {"pipeline": name, "scene": scene["id"], "i": i}
                if "s2s" in cfg:
                    r = s2s_once(*cfg["s2s"], msgs, wav, out)
                    msgs += [{"role": "user", "content": line["text"]}, {"role": "assistant", "content": r["text"]}]
                    row.update(stt=0, llm_clause=0, tts_ttfb=0, measured=r["first_audio"], text=r["text"],
                               her=line["text"], path=r["path"])
                else:
                    if cfg["stt"]:
                        s = stt_once(cfg["stt"], wav)
                        her, stt_s = s["text"], s["s"]
                        turn = {"role": "user", "content": her}
                    else:
                        her, stt_s = line["text"], 0.0
                        turn = {"role": "user", "content": [{"type": "input_audio", "input_audio": {
                            "data": base64.b64encode(wav.read_bytes()).decode(), "format": "wav"}}]}
                    r = stream_reply(cfg["llm"], msgs + [turn])
                    # TTS starts on the first clause; later clauses are generated while it plays.
                    clone = cfg.get("clone", False)
                    if r["text"] == "...":
                        row.update(stt=stt_s, llm_clause=r["first_clause"], tts_ttfb=0, measured=None,
                                   text=r["text"], her=her, path=None)
                        msgs += [{"role": "user", "content": her}, {"role": "assistant", "content": r["text"]}]
                        log("live", row)
                        print(f"  {name:24} {scene['id']}:{i} (stays silent)")
                        continue
                    first = tts_stream(*cfg["tts"], r["clause"], out.with_name(out.name + "_a"), clone=clone)
                    rest = r["text"][len(r["clause"]):].strip()
                    paths = [first["path"]]
                    if rest:
                        paths.append(tts_stream(*cfg["tts"], rest, out.with_name(out.name + "_b"),
                                                clone=clone)["path"])
                    msgs += [{"role": "user", "content": her}, {"role": "assistant", "content": r["text"]}]
                    row.update(stt=stt_s, llm_clause=r["first_clause"], tts_ttfb=first["ttfb"],
                               measured=stt_s + r["first_clause"] + first["ttfb"], text=r["text"], her=her,
                               path=paths)
                log("live", row)
                print(f"  {name:24} {scene['id']}:{i} stt {row['stt']:.2f} llm {row['llm_clause']:.2f} "
                      f"tts {row['tts_ttfb']:.2f} -> {row['measured']:.2f}s | {row['text'][:60]}")


def render(tail: float = 0.5):
    """Hear it: her lines, then each reply after the real measured delay (+ turn-detection tail)."""
    latest: dict[tuple, dict] = {}
    for r in rows("live"):
        latest[(r["pipeline"], r["scene"], r["i"])] = r
    for name in PIPELINES:
        for scene in SCENES:
            clips = []
            for i, line in enumerate(scene["lines"]):
                if line["who"] != "girl":
                    continue
                r = latest.get((name, scene["id"], i))
                if not r:
                    break
                clips.append(("girl", 0.4, load(next(LINES.glob(f"{scene['id']}_{i:02d}_girl.*")))))
                if not r.get("path"):
                    continue
                paths = r["path"] if isinstance(r["path"], list) else [r["path"]]
                dad = np.concatenate([load(Path(p)) for p in paths if p])
                clips.append(("dad", tail + r["measured"], dad))
            if clips:
                out = mix_scene_custom(clips, scene, LAT / "mix" / f"{scene['id']}__{name}.mp3")
                print("  render", out.relative_to(OUT))


def judge_live():
    """Score each live reply's audio for the dad role (accent, Hindi, naturalness, fit)."""
    from lab import judge, score_of
    done = {(r["pipeline"], r["scene"], r["i"]) for r in rows("judge")}
    for r in rows("live"):
        key = (r["pipeline"], r["scene"], r["i"])
        if key in done or not r.get("path"):
            continue
        path = Path(r["path"][0] if isinstance(r["path"], list) else r["path"])
        try:
            s = judge(path, "dad", r["text"])
        except Exception as e:
            print("  ERR judge", key, str(e)[:120])
            continue
        log("judge", {"pipeline": r["pipeline"], "scene": r["scene"], "i": r["i"], "score": score_of(s), **s})
        print(f"  {r['pipeline']:24} {r['scene']}:{r['i']} {score_of(s):.1f} | {s.get('notes', '')[:80]}")


# --------------------------------------------------------------------------- report

def med(xs):
    xs = [x for x in xs if isinstance(x, (int, float))]
    return statistics.median(xs) if xs else float("nan")


def report():
    lines = ["# Latency report", "", f"Turn-detection tails added on top: {TAILS}", ""]
    t = rows("tts")
    if t:
        lines += ["## TTS: first audio byte (median, s)", "", "| model | clause | sentence | streams? |", "|---|---|---|---|"]
        for model, *_ in TTS_CANDIDATES:
            c = [r for r in t if r["model"] == model]
            if not c:
                continue
            cl, se = med([r["ttfb"] for r in c if r["kind"] == "clause"]), med([r["ttfb"] for r in c if r["kind"] == "sentence"])
            ratio = med([r["ttfb"] / r["total"] for r in c if r["kind"] == "sentence"])
            lines.append(f"| {model} | {cl:.2f} | {se:.2f} | {'yes' if ratio < 0.7 else 'no'} ({ratio:.0%} of total) |")
    for name, title in (("stt", "STT (median s)"), ("llm", "LLM streaming (median s)"),
                        ("audiollm", "Audio-in LLM (median s)"), ("s2s", "Speech-to-speech (median s)")):
        rs = rows(name)
        if not rs:
            continue
        lines += ["", f"## {title}", ""]
        models = list(dict.fromkeys(r["model"] for r in rs))
        if name == "stt":
            lines += ["| model | time |", "|---|---|"]
            lines += [f"| {m} | {med([r['s'] for r in rs if r['model'] == m]):.2f} |" for m in models]
        elif name == "s2s":
            lines += ["| model | first audio | done |", "|---|---|---|"]
            lines += [f"| {m} | {med([r['first_audio'] for r in rs if r['model'] == m]):.2f} | "
                      f"{med([r['done'] for r in rs if r['model'] == m]):.2f} |" for m in models]
        else:
            lines += ["| model | first token | first clause | done | sample reply |", "|---|---|---|---|---|"]
            for m in models:
                mr = [r for r in rs if r["model"] == m]
                sample = next((r["text"] for r in mr if r["scene"] == "cab_night" and r["i"] == 0), "")
                lines.append(f"| {m} | {med([r['ttft'] for r in mr]):.2f} | {med([r['first_clause'] for r in mr]):.2f} "
                             f"| {med([r['done'] for r in mr]):.2f} | {sample[:60]} |")
    lv, jd = rows("live"), rows("judge")
    if lv:
        lines += ["", "## Live pipelines: her last word -> his first sound (median s)", "",
                  "| pipeline | stt | llm clause | tts first byte | measured | " + " | ".join(TAILS)
                  + " | voice score | silent turns |",
                  "|---|---|---|---|---|" + "---|" * len(TAILS) + "---|---|"]
        for name in PIPELINES:
            r = [x for x in lv if x["pipeline"] == name]
            if not r:
                continue
            m = med([x["measured"] for x in r])
            sc = med([j["score"] for j in jd if j["pipeline"] == name])
            silent = sum(1 for x in r if x.get("measured") is None)
            lines.append(f"| {name} | {med([x['stt'] for x in r]):.2f} | {med([x['llm_clause'] for x in r]):.2f} | "
                         f"{med([x['tts_ttfb'] for x in r]):.2f} | {m:.2f} | "
                         + " | ".join(f"{m + tail:.2f}" for tail in TAILS.values())
                         + f" | {sc:.1f} | {silent}/{len(r)} |")
    (LAT / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else "report"
    fn = {"tts": bench_tts, "stt": bench_stt, "llm": bench_llm, "audiollm": bench_audiollm, "s2s": bench_s2s,
          "live": lambda: live(sys.argv[2:] or None), "judge": judge_live, "render": render,
          "report": report}[stage]
    fn()
    print(f"spent so far: ${orlib.reconcile():.3f}")
