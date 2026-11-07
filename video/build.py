# /// script
# dependencies = ["pillow"]
# ///
"""Assemble the Pahunchi demo video from the phone captures (capture.mjs) and real call takes (take.ts).

  uv run video/build.py full      # -> video/renders/phoney_demo_full.mp4
  uv run video/build.py teaser    # -> video/renders/phoney_demo_teaser.mp4

Layout: 1080x1920, the phone as a rounded card on a dark background, English captions below,
latency chips above. Audio: ringback, the real takes (his voice through the phone band, real gaps),
a ringtone for the scheduled call; silence elsewhere.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
SCREENS = HERE / "screens"
REC = SCREENS / "rec"
TAKES = HERE / "audio" / "takes"
WORK = HERE / "renders" / "work"
FONT = HERE / "fonts" / "Nunito.ttf"
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/nunito/Nunito%5Bwght%5D.ttf"

W, H, FPS = 1080, 1920, 30
PHONE_H = 1530
PHONE_W = round(PHONE_H * 1170 / 2532)
PHONE_X, PHONE_Y = (W - PHONE_W) // 2, 150
BG_TOP, BG_BOTTOM = (16, 24, 40), (8, 12, 22)
GREEN, BLUE, WHITE = (88, 204, 2), (28, 176, 246), (255, 255, 255)

# English meaning of each line in the takes, in timeline order.
MEANING = {
    "cab-2": [
        "Yes beta, tell me. You're in the cab?",
        "Hello Papa? Yes, I just got in the cab.",
        "Okay, good. What's the car's number?",
        "A white Dzire. DL 3C AB 4521.",
        "Noted it down. How long until you're home?",
        "Just twenty, twenty-five minutes.",
        "Okay, take it easy. I can see your location now.",
    ],
    "escape-4": [
        "Beta, come home quickly. Dadi isn't well, she keeps asking for you.",
        "Oh? Okay Papa, I'm leaving right now.",
        "Okay, come quickly. Once you book a cab, send me its number.",
    ],
}


def font(size: int, weight: str = "ExtraBold") -> ImageFont.FreeTypeFont:
    if not FONT.exists():
        FONT.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(FONT_URL, FONT)
    f = ImageFont.truetype(str(FONT), size)
    f.set_variation_by_name(weight)
    return f


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=f) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line] if line else lines


def background(shadow: bool = True) -> Path:
    out = WORK / ("bg.png" if shadow else "bg_plain.png")
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        k = y / H
        c = tuple(round(a + (b - a) * k) for a, b in zip(BG_TOP, BG_BOTTOM))
        for x in range(W):
            px[x, y] = c
    if shadow:  # soft shadow under the phone card
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).rounded_rectangle((PHONE_X - 6, PHONE_Y + 14, PHONE_X + PHONE_W + 6, PHONE_Y + PHONE_H + 24), 60, fill=150)
        img.paste((0, 0, 0), mask=m.filter(ImageFilter.GaussianBlur(28)))
    img.save(out)
    return out


def phone_mask() -> Path:
    out = WORK / "mask.png"
    m = Image.new("L", (PHONE_W, PHONE_H), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, PHONE_W - 1, PHONE_H - 1), 54, fill=255)
    m.save(out)
    return out


def caption_png(name: str, text: str, speaker: str | None = None) -> Path:
    """Caption band below the phone: optional coloured speaker label, then the line."""
    out = WORK / f"cap_{name}.png"
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(46)
    width = W - 160
    lines = wrap(d, text, f, width)
    label_h = 50 if speaker else 0
    block_h = label_h + len(lines) * 60
    top = PHONE_Y + PHONE_H + max(24, (H - PHONE_Y - PHONE_H - block_h) // 2 - 6)
    if speaker:
        colour = GREEN if speaker.startswith("Papa") else BLUE
        d.text((W // 2, top), speaker, font=font(36), fill=colour, anchor="ma")
    for i, line in enumerate(lines):
        d.text((W // 2, top + label_h + i * 60), line, font=f, fill=WHITE, anchor="ma")
    img.save(out)
    return out


def chip_png(name: str, text: str) -> Path:
    """Pill above the phone, e.g. the measured reply time."""
    out = WORK / f"chip_{name}.png"
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = font(40)
    tw = d.textlength(text, font=f)
    x0, y0 = (W - tw) / 2 - 34, 40
    d.rounded_rectangle((x0, y0, x0 + tw + 68, y0 + 74), 37, fill=(88, 204, 2, 235))
    d.text((W // 2, y0 + 37), text, font=f, fill=WHITE, anchor="mm")
    img.save(out)
    return out


def title_png(name: str, text: str) -> Path:
    out = WORK / f"title_{name}.png"
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((W // 2, 82), text, font=font(44), fill=(255, 255, 255, 230), anchor="mm")
    img.save(out)
    return out


def latency_card(turns: list[dict]) -> Path:
    """Her last word -> his first sound, per turn, split into stages (real measurements from the take)."""
    out = WORK / "latency.png"
    img = Image.open(background(shadow=False)).convert("RGB")
    d = ImageDraw.Draw(img)
    d.text((W // 2, 330), "How fast he answers", font=font(68), fill=WHITE, anchor="mm")
    d.text((W // 2, 420), "from her last word to his first sound", font=font(38, "SemiBold"), fill=(200, 210, 225), anchor="mm")
    colours = {"wait": (90, 100, 120), "stt": BLUE, "llm": (206, 130, 255), "tts": GREEN}
    scale = 300  # px per second
    x0, y = 150, 560
    for t in turns:
        parts = [("wait", 0.3), ("stt", t["sttMs"] / 1000), ("llm", t["clause"] / 1000), ("tts", t["tts"] / 1000)]
        x = x0
        for key, s in parts:
            d.rounded_rectangle((x, y, x + s * scale - 6, y + 80), 14, fill=colours[key])
            x += s * scale
        d.text((x + 24, y + 40), f"{t['totalMs'] / 1000:.1f} s", font=font(52), fill=WHITE, anchor="lm")
        y += 140
    legend = [("wait", "turn end"), ("stt", "speech to text"), ("llm", "reply"), ("tts", "voice")]
    lx, ly = 150, y + 40
    for key, label in legend:
        d.rounded_rectangle((lx, ly, lx + 34, ly + 34), 8, fill=colours[key])
        d.text((lx + 48, ly + 17), label, font=font(34, "Bold"), fill=(220, 226, 236), anchor="lm")
        ly += 58
    d.text((W // 2, ly + 120), "Earlier builds took 4.3 s.", font=font(40, "SemiBold"), fill=(200, 210, 225), anchor="mm")
    d.text((W // 2, ly + 180), "A cached \"hmm\" covers slow turns.", font=font(40, "SemiBold"), fill=(200, 210, 225), anchor="mm")
    img.save(out)
    return out


def end_card() -> Path:
    out = WORK / "end.png"
    img = Image.open(background(shadow=False)).convert("RGB")
    d = ImageDraw.Draw(img)
    d.text((W // 2, 760), "Pahunchi", font=font(150, "Black"), fill=WHITE, anchor="mm")
    d.text((W // 2, 900), "A call that talks back,", font=font(50, "Bold"), fill=(210, 220, 232), anchor="mm")
    d.text((W // 2, 968), "for the walk or the cab home.", font=font(50, "Bold"), fill=(210, 220, 232), anchor="mm")
    d.rounded_rectangle((150, 1120, W - 150, 1240), 60, fill=GREEN)
    d.text((W // 2, 1180), "pahunchi.netlify.app", font=font(54), fill=WHITE, anchor="mm")
    d.text((W // 2, 1320), "Free · Hindi, English, Hinglish", font=font(40, "SemiBold"), fill=(180, 192, 210), anchor="mm")
    img.save(out)
    return out


@dataclass
class Shot:
    source: Path  # mp4 clip or png (still); png at 1080x1920 is a full-frame card
    seconds: float
    start: float = 0.0  # offset into a clip
    overlays: list[tuple[Path, float, float]] = field(default_factory=list)  # png, from, to (shot time)
    audio: list[tuple[Path, float]] = field(default_factory=list)  # wav, at (shot time)
    full_frame: bool = False


def render_shot(i: int, s: Shot, bg: Path, mask: Path) -> Path:
    out = WORK / f"shot_{i:02d}.mp4"
    args = ["ffmpeg", "-v", "error", "-y"]
    if s.full_frame:
        args += ["-loop", "1", "-t", f"{s.seconds:.3f}", "-i", str(s.source)]
        chain = "[0:v]scale=1080:1920,format=yuv420p[v0]"
    else:
        args += ["-loop", "1", "-t", f"{s.seconds:.3f}", "-i", str(bg)]
        if s.source.suffix == ".png":
            args += ["-loop", "1", "-t", f"{s.seconds:.3f}", "-i", str(s.source)]
        else:
            args += ["-ss", f"{s.start:.3f}", "-t", f"{s.seconds:.3f}", "-i", str(s.source)]
        args += ["-loop", "1", "-t", f"{s.seconds:.3f}", "-i", str(mask)]
        chain = (f"[1:v]fps={FPS},scale={PHONE_W}:{PHONE_H}:flags=lanczos,tpad=stop_mode=clone:stop_duration=60,"
                 f"format=rgba[ph];[2:v]format=gray[m];[ph][m]alphamerge[phm];"
                 f"[0:v][phm]overlay={PHONE_X}:{PHONE_Y}:shortest=1[v0]")
    base = 1 if s.full_frame else 3
    for k, (png, a, b) in enumerate(s.overlays):
        args += ["-loop", "1", "-t", f"{s.seconds:.3f}", "-i", str(png)]
        chain += f";[v{k}][{base + k}:v]overlay=0:0:enable='between(t,{a:.3f},{b:.3f})'[v{k + 1}]"
    last = f"v{len(s.overlays)}"
    chain += f";[{last}]fps={FPS},format=yuv420p,trim=duration={s.seconds:.3f}[out]"
    args += ["-filter_complex", chain, "-map", "[out]", "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-r", str(FPS), str(out)]
    subprocess.run(args, check=True)
    return out


def tone_wav(name: str, pattern: list[tuple[float, float]], cycle: float, seconds: float, freqs: str, gain: float) -> Path:
    """Repeating on/off tone: pattern of (on_from, on_to) within each cycle."""
    out = WORK / f"{name}.wav"
    on = "+".join(f"between(mod(t,{cycle}),{a},{b})" for a, b in pattern)
    expr = "+".join(f"sin(2*PI*{f}*t)" for f in freqs.split(","))
    n = len(freqs.split(","))
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    f"aevalsrc='{gain}/{n}*({expr})*gt({on},0)':s=44100:d={seconds}",
                    "-af", "highpass=f=300,lowpass=f=3400", str(out)], check=True)
    return out


def take(id: str) -> tuple[dict, Path]:
    d = json.loads((TAKES / id / "take.json").read_text())
    return d, TAKES / id / "mix.wav"


def call_overlays(take_id: str, offset: float, until: float | None = None) -> list[tuple[Path, float, float]]:
    """English caption per line while it is spoken (held until the next line) and a chip with his measured reply time."""
    d, _ = take(take_id)
    tl = d["timeline"]
    out = []
    for k, e in enumerate(tl):
        nxt = tl[k + 1]["start"] if k + 1 < len(tl) else e["end"] + 1.5
        if until is not None and e["start"] >= until:
            break
        speaker = "Papa (AI)" if e["who"] == "them" else "Priya"
        cap = caption_png(f"{take_id}_{k}", MEANING[take_id][k], speaker)
        out.append((cap, offset + e["start"], offset + nxt))
        if e.get("totalMs"):
            chip = chip_png(f"{take_id}_{k}", f"replied in {e['totalMs'] / 1000:.1f} s")
            out.append((chip, offset + e["start"], offset + e["end"]))
    return out


def rec_meta(name: str) -> dict:
    return json.loads((REC / f"{name}.json").read_text())


def plan(cut: str) -> list[Shot]:
    cab, cab_wav = take("cab-2")
    esc, esc_wav = take("escape-4")
    m_cab, m_esc = rec_meta("r02_cab_call"), rec_meta("r07_escape_call")
    ring = m_cab["pickup"] - m_cab["ringStart"]
    ringback = tone_wav("ringback", [(0, 0.4), (0.6, 1.0)], 3.0, ring, "400", 0.25)
    ringtone = tone_wav("ringtone", [(0, 0.4), (0.6, 1.0)], 2.0, 2.7, "440,480", 0.3)

    def cab_call(until: float | None) -> Shot:
        """until: cut after this many seconds of the take (default: the whole call)."""
        end = until if until is not None else cab["timeline"][-1]["end"] + 1.0
        return Shot(REC / "r02_cab_call.mp4", ring + end, start=m_cab["ringStart"],
                    overlays=[(caption_png("ringing", "It rings like a real call."), 0, ring)] + call_overlays("cab-2", ring, until),
                    audio=[(ringback, 0), (cab_wav, ring)])

    home = Shot(REC / "r01_home.mp4", 3.9, overlays=[(caption_png("home", "Walking alone or in a cab at night? Pick who picks up."), 0, 3.9)])
    safe = Shot(SCREENS / "05_after_call.png", 1.3, overlays=[(caption_png("safe1", "Home safe? One tap."), 0, 1.3)])
    safe2 = Shot(REC / "r03_safe.mp4", 2.2, start=1.45, overlays=[(caption_png("safe2", "Nobody gets disturbed."), 0, 2.2)])
    shared = Shot(SCREENS / "13_contact_history_shared.png", 4.2, overlays=[
        (caption_png("shared", "If she doesn't check in, her sister sees the call and the cab number."), 0, 4.2)])
    end = Shot(end_card(), 3.5, full_frame=True)

    if cut == "teaser":
        return [home, cab_call(until=cab["timeline"][4]["end"] + 0.5), safe, safe2, shared, end]

    turns = [t for t in cab["turns"] if t["who"] == "them" and t.get("totalMs")]
    stt = {t["turn"]: t["sttMs"] for t in cab["turns"] if t["who"] == "her"}
    lat = latency_card([{**t, "sttMs": stt[t["turn"]]} for t in turns])
    esc_len = esc["timeline"][-1]["end"] + 1.0
    return [
        home,
        cab_call(until=None),
        Shot(lat, 4.5, full_frame=True),
        safe, safe2,
        Shot(SCREENS / "11_contacts_signed_out.png", 2.4, overlays=[(caption_png("signin", "Add trusted contacts with Google sign-in."), 0, 2.4)]),
        Shot(SCREENS / "12_contacts_signed_in.png", 3.4, overlays=[
            (caption_png("contacts", "Each one hears right away, or only if you don't check in."), 0, 3.4)]),
        shared,
        Shot(REC / "r05_later.mp4", 4.4, overlays=[(caption_png("later", "Need a way out? Schedule a call."), 0, 4.4)]),
        Shot(REC / "r06_incoming.mp4", 2.7, overlays=[(caption_png("incoming", "Papa rings at the time you chose."), 0, 2.7)],
             audio=[(ringtone, 0)]),
        Shot(REC / "r07_escape_call.mp4", esc_len, start=m_esc["pickup"], overlays=call_overlays("escape-4", 0),
             audio=[(esc_wav, 0)]),
        Shot(REC / "r08_go.mp4", 2.5, overlays=[(caption_png("go", "Add it to your home screen: one tap calls."), 0, 2.5)]),
        end,
    ]


def main() -> None:
    cut = sys.argv[1] if len(sys.argv) > 1 else "full"
    WORK.mkdir(parents=True, exist_ok=True)
    bg, mask = background(), phone_mask()
    shots = plan(cut)
    files, audio, t = [], [], 0.0
    for i, s in enumerate(shots):
        files.append(render_shot(i, s, bg, mask))
        audio += [(wav, t + at, s.seconds - at) for wav, at in s.audio]
        t += s.seconds
        print(f"shot {i:02d} {s.source.name:32s} {s.seconds:5.2f}s  ends {t:5.2f}s")
    (WORK / "list.txt").write_text("".join(f"file '{f.resolve()}'\n" for f in files))
    silent = WORK / f"{cut}_silent.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(WORK / "list.txt"), "-c", "copy", str(silent)], check=True)

    args = ["ffmpeg", "-v", "error", "-y", "-i", str(silent)]
    parts = []
    for k, (wav, at, length) in enumerate(audio):
        args += ["-i", str(wav)]
        parts.append(f"[{k + 1}:a]aresample=44100,aformat=channel_layouts=mono,atrim=0:{length:.3f},"
                     f"afade=t=out:st={max(0, length - 0.2):.3f}:d=0.2,adelay={round(at * 1000)}:all=1[a{k}]")
    mixdown = "".join(f"[a{k}]" for k in range(len(audio)))
    parts.append(f"{mixdown}amix=inputs={len(audio)}:normalize=0:duration=longest,apad,atrim=0:{t:.3f},"
                 f"loudnorm=I=-16:TP=-1.5,afade=t=out:st={t - 0.6:.3f}:d=0.6[aout]")
    out = HERE / "renders" / f"phoney_demo_{cut}.mp4"
    args += ["-filter_complex", ";".join(parts), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k",
             "-ac", "2", "-shortest", "-movflags", "+faststart", str(out)]
    subprocess.run(args, check=True)
    print(f"-> {out} ({t:.1f} s)")


if __name__ == "__main__":
    main()
