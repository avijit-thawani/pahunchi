# Charts for the STT evaluation (scripts/stt-eval.ts report writes stats.json).
#   uv run --with matplotlib scripts/stt-chart.py   -> logs/stt-bench/stt-eval.png
import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

S = json.load(open("logs/stt-bench/stats.json"))
S.sort(key=lambda s: s["p50"])
COLORS = {"batch": "#be8cff", "stream": "#4cc9f0"}
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
fig, (a, b) = plt.subplots(1, 2, figsize=(13, 4.8), gridspec_kw={"width_ratios": [1.1, 1]})

# Left: ready after she stops, p50 and p90 with 95% CIs.
y = range(len(S))
for i, s in enumerate(S):
    c = COLORS[s["kind"]]
    a.errorbar(s["p50"], i + 0.12, xerr=[[s["p50"] - s["p50ci"][0]], [s["p50ci"][1] - s["p50"]]], fmt="o", color=c, capsize=4, ms=7)
    a.errorbar(s["p90"], i - 0.12, xerr=[[s["p90"] - s["p90ci"][0]], [s["p90ci"][1] - s["p90"]]], fmt="s", color=c, mfc="white", capsize=4, ms=6)
    a.text(max(s["p90ci"][1], s["p90"]) + 25, i, f'{s["p50"]:.0f} / {s["p90"]:.0f} ms', va="center", fontsize=9, color="#444")
a.set_yticks(list(y), [s["label"] for s in S])
a.set_xlabel("text ready after she stops (ms)   ● p50   □ p90   bars = 95% CI")
a.set_xlim(0, max(s["p90ci"][1] for s in S) + 330)
a.set_title(f'Speed: {S[0]["samples"]}+ samples per engine (4 rounds x 57 lines)', loc="left", fontsize=11)
a.invert_yaxis()

# Right: accuracy vs speed; marker area = $ per minute.
OFFSET = {"sarvam": (10, -26, "left"), "sarvam-codemix": (10, 14, "left"), "scribe": (10, 34, "left"),
          "sarvam-stream": (-14, 8, "right"), "scribe-stream": (10, -4, "left"), "gpt-mini": (10, -4, "left")}
for s in S:
    c = COLORS[s["kind"]]
    b.errorbar(s["p50"], s["score"], yerr=[[s["score"] - s["scoreci"][0]], [s["scoreci"][1] - s["score"]]], fmt="o", color=c, capsize=4,
               ms=6 + 1400 * s["usdPerMin"])
    dx, dy, ha = OFFSET.get(s["name"], (9, -4, "left"))
    b.annotate(f'{s["label"]}\n${s["usdPerMin"] * 60:.2f}/hr', (s["p50"], s["score"]), textcoords="offset points", xytext=(dx, dy), ha=ha, fontsize=8, color="#333")
b.set_xlabel("text ready after she stops, p50 (ms)")
b.set_ylabel("judge score (0-2, mean of 3 judges), 95% CI")
b.set_ylim(0.4, 1.5)
b.set_xlim(0, 900)
b.set_title("Accuracy vs speed (marker size = cost)", loc="left", fontsize=11)
b.scatter([], [], color=COLORS["batch"], label="batch (after she stops)")
b.scatter([], [], color=COLORS["stream"], label="streaming (while she talks)")
b.legend(loc="lower right", fontsize=8, frameon=False)

fig.suptitle("Speech-to-text on 57 real call lines (2.6 min), 2026-11-07", x=0.01, ha="left", fontsize=12, weight="bold")
fig.tight_layout()
fig.savefig("logs/stt-bench/stt-eval.png", dpi=160)
print("logs/stt-bench/stt-eval.png")
