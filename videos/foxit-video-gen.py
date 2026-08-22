#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
foxit-video-gen.py — Foxit 赛题 demo 视频渲染器（1920x1080@30fps，约 2:38）。
用真实运行转录（2026-08-22 实测）+ 确定性 mock 反例，全部文本帧。
零外部素材：PIL 画帧 -> ffmpeg concat 合成。输出 .devpost-foxit/foxit-demo.mp4
用法：python videos/foxit-video-gen.py
"""
import os, subprocess, json
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1920, 1080, 30
OUT = os.path.join(os.path.dirname(__file__), "..", ".devpost-foxit", "foxit-demo.mp4")
WORK = os.path.join(os.path.dirname(__file__), "..", ".devpost-foxit", ".video-frames")
os.makedirs(WORK, exist_ok=True)

F = {
    "mono":  r"C:\Windows\Fonts\consola.ttf",
    "monob": r"C:\Windows\Fonts\consolab.ttf",
    "cjk":   r"C:\Windows\Fonts\msyh.ttc",
    "cjkb":  r"C:\Windows\Fonts\msyhbd.ttc",
}
def font(sz, bold=False, cjk=False):
    path = F["cjkb" if (cjk and bold) else "cjk" if cjk else "monob" if bold else "mono"]
    try:
        return ImageFont.truetype(path, sz)
    except Exception:
        return ImageFont.truetype(F["cjk"], sz)

def pick_font(text, sz, bold=False):
    """ASCII-only -> Consolas；含 CJK -> YaHei（混排时整行 YaHei）"""
    need_cjk = any(ord(c) > 0x2E7F for c in text)
    return font(sz, bold=bold, cjk=need_cjk)

# 样式：颜色 + 前景/是否粗体
STYLE = {
    "cmd":  ((0, 255, 140), False, False),   # 终端命令（绿）
    "out":  ((220, 220, 220), False, False),  # 输出（浅灰）
    "ok":   ((0, 255, 140), False, False),
    "warn": ((255, 210, 60), False, False),
    "err":  ((255, 90, 90), False, False),
    "hdr":  ((110, 180, 255), True, True),
    "title":((255, 255, 255), True, True),
    "sub":  ((150, 150, 150), False, True),
    "meta": ((120, 120, 130), False, True),
}

def esc(t):
    # 非 BMP/少见符号替换成 ASCII 标记，避免缺字
    return (t.replace("✓", "[v]").replace("✅", "[OK]").replace("⚠️", "[!]")
             .replace("⚠", "[!]").replace("🚫", "[REFUSE]"))

# ---------------- 场景定义 ----------------
# (duration_seconds, [(text, style), ...])，行按 0.45s 逐步揭示
S = []
def sc(dur, lines):
    S.append((dur, [(esc(t), st) for t, st in lines]))

sc(6, [
    ("Who Signed That", "title"),
    ("", "title"),
    ("Your agent shouldn't sign that.", "out"),
    ("When a human says yes — keep the receipt.", "out"),
    ("", "out"),
    ("Foxit Challenge · DevNetwork [API+Cloud+AI] Hackathon 2026 · task-passport", "meta"),
])
sc(12, [
    ("THE PROBLEM", "hdr"),
    ("Leaving signing out of the agent's toolset stops the agent.", "out"),
    ("It does NOT produce a record of why a human said yes.", "warn"),
    ("The missing half: make the approval itself a first-class object —", "out"),
    ("versioned, portable, and bound to the exact document it approved.", "out"),
])
sc(30, [
    ("THE REAL RUN — part 1 · the agent works (live Foxit PDF Services)", "hdr"),
    ("$ node cli.js new --title \"Consulting agreement for Acme Co.\"", "cmd"),
    ("  passport TP-UU2Q-D3GG created", "out"),
    ("$ node examples/foxit/agent.mjs draft --passport TP-UU2Q-D3GG", "cmd"),
    ("  [2/4] PDF generated via Foxit PDF Services (HTML -> PDF)", "out"),
    ("        contract.pdf  sha256=22177d55...e0a7483  (full hash in repo)", "out"),
    ("  [3/4] self-check via real text extraction: fee clause [v]  term [v]", "ok"),
    ("        recorded as machine-verified fact in the passport", "out"),
    ("  [4/4] signing boundary reached — packing handoff file + the ask", "out"),
    ("[REFUSE]  I cannot sign. I need a human's approval.", "err"),
    ("  (exit 0 — refusing correctly is the expected outcome)", "sub"),
])
sc(20, [
    ("HUMAN REVIEW — facts degrade at pack time", "hdr"),
    ("$ node examples/foxit/review.mjs show for-review.taskpack.json", "cmd"),
    ("[!] UNVERIFIED [machine] contract.pdf has fee clause (5000/mo) & 12-month term", "warn"),
    ("      It was verified on the agent's machine — sealed at pack time.", "out"),
    ("      On YOUR machine it stays unverified until you re-check it.", "out"),
    ("$ node examples/foxit/review.mjs approve ... --actor \"Reviewer\"", "cmd"),
    ("  receipt: approve sha256=22177d55...e0a7483", "ok"),
])
sc(26, [
    ("SIGN — four gates, then the real eSign API", "hdr"),
    ("$ node examples/foxit/agent.mjs sign --passport TP-UU2Q-D3GG", "cmd"),
    ("  gate 1  someone answered the ask ............. [v] approve", "ok"),
    ("  gate 2  the answer is approve ................. [v]", "ok"),
    ("  gate 3  receipt sha256 == live file sha256 .... [v]", "ok"),
    ("  gate 4  Foxit eSign envelope created & sent ... [v]", "ok"),
    ("          folderId=35504526  sent at 2026-08-22T08:02:52Z", "out"),
    ("  full chain checkpointed back to the passport (version 7)", "out"),
])
sc(16, [
    ("PROOF — the invitation actually arrived", "hdr"),
    ("From:    Independent Developer via Foxit eSign <notifications@foxitsign.com>", "out"),
    ("Subject: Please review or esign the document(s) consulting-agreement", "out"),
    ("Date:    Sat, 22 Aug 2026 08:02:52 +0000 (UTC)", "out"),
    ("", "out"),
    ("The envelope the agent sent is sitting in the recipient's real inbox.", "ok"),
])
sc(24, [
    ("THE REFUSALS — same gates, deterministic demo runs", "hdr"),
    ("CASE 1 — nobody approved:", "warn"),
    ("  没有人批准过，拒绝送签。 ask a1 状态=open", "out"),
    ("  exit code 3 — the agent refuses to sign.", "ok"),
    ("", "out"),
    ("CASE 2 — document modified after approval:", "warn"),
    ("  批准的是 9ddc0094...，我手上是 4cc0f738...，拒绝送签。", "err"),
    ("  exit code 2 — the agent refuses to sign the wrong version.", "ok"),
])
sc(10, [
    ("WHAT THIS PROVES — AND WHAT IT DOESN'T", "hdr"),
    ("Proves: which version was approved, by whom, and when.", "out"),
    ("Does NOT prove the person exists — receipts are not notarization.", "warn"),
    ("The value: mistakes become visible, denial becomes hard.", "out"),
])
sc(12, [
    ("TRY IT YOURSELF — one command, no credentials, no network", "hdr"),
    ("$ bash examples/foxit/demo.sh", "cmd"),
    ("$ bash examples/foxit/demo.sh --no-approval     # exits 3", "cmd"),
    ("$ bash examples/foxit/demo.sh --tamper          # exits 2", "cmd"),
    ("", "out"),
    ("github.com/dongsheng123132/task-passport   ·   npm i task-passport", "ok"),
    ("Set FOXIT_CLOUD_API_CLIENT_ID/SECRET and the same flow hits live Foxit APIs.", "sub"),
])

# ---------------- 渲染 ----------------
BLACK = (8, 10, 14)
def draw_scene(idx, n_visible):
    img = Image.new("RGB", (W, H), BLACK)
    d = ImageDraw.Draw(img)

    # 宽度守卫：超界立即报错（行长要缩）
    for text, st in lines[:n_visible]:
        if text == "" or st == "hdr":
            continue
        f = pick_font(text, 36, bold=STYLE[st][1])
        if d.textlength(text, font=f) > W - 2 * 130:
            raise SystemExit(f"LINE OVERFLOW ({len(text)}ch): {text[:60]}...")
    # 顶部状态条
    d.rectangle([0, 0, W, 64], fill=(14, 18, 26))
    d.text((40, 14), "who-signed-that · task-passport · Foxit eSign demo", font=font(26, cjk=True), fill=(120, 140, 160))
    d.text((W - 320, 18), "recording: real run 2026-08-22", font=font(24, cjk=True), fill=(100, 110, 120))
    d.line([(0, 64), (W, 64)], fill=(40, 50, 64), width=2)
    # 正文
    y = 140
    x = 130
    for i, (text, st) in enumerate(scene_lines[:n_visible]):
        if i == 0 and st == "hdr":
            d.text((x, y), text, font=font(40, bold=True, cjk=True), fill=STYLE["hdr"][0])
            y += 62
            continue
        col, bold, _ = STYLE[st]
        f = pick_font(text, 36, bold=bold)
        d.text((x, y), text, font=f, fill=col)
        y += 54
    return img

frames = []  # (path, dur)
t = 0.0
for si, (dur, lines) in enumerate(S):
    scene_lines = lines
    total_steps = len(lines)
    step_dur = 0.45  # 每行揭示间隔（秒）
    for k in range(1, total_steps + 1):  # 第 k 步显示前 k 行
        png = os.path.join(WORK, f"s{si:02d}_k{k:02d}.png")
        draw_scene(si, k).save(png)
        frames.append((png, step_dur))
    # 最后多留 (dur - total_steps*step_dur) 秒
    extra = dur - total_steps * step_dur
    if extra > 0.3:
        frames.append((frames[-1][0], extra))

# 写 concat 清单
lst = os.path.join(WORK, "list.txt")
with open(lst, "w", encoding="utf-8") as fh:
    for png, d in frames:
        fh.write(f"file '{os.path.abspath(png)}'\nduration {d:.3f}\n")
    last = frames[-1][0]
    fh.write(f"file '{os.path.abspath(last)}'\n")

cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst,
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
       "-r", str(FPS), "-movflags", "+faststart", OUT]
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print(r.stderr[-1200:])
    raise SystemExit(1)
dur_total = sum(d for _, d in frames)
print(f"OK -> {os.path.abspath(OUT)}  frames={len(frames)}  duration={dur_total:.1f}s")