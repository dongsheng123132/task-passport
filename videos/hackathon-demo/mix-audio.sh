#!/usr/bin/env bash
# 混音：11 段旁白按时间轴摆放 + CC0 合成背景乐（旁白时自动压低）+ 合并进视频（画面不重编码）
set -e
BASE="D:/uking编程/task-passport/videos/hackathon-demo"
OUT="$BASE/audio-out"
SRC="$BASE/out/taskpassport-demo.mp4"
BGM="$OUT/bgm.wav"
FINAL="$BASE/out/taskpassport-demo-with-audio.mp4"

# ---- 1. 合成背景乐：A2+E3+A3+E4 静音垫 + 低通 + 回声 + 微颤音（210s） ----
ffmpeg -y -v error \
  -f lavfi -i "sine=frequency=55:duration=210" \
  -f lavfi -i "sine=frequency=110:duration=210" \
  -f lavfi -i "sine=frequency=164.81:duration=210" \
  -f lavfi -i "sine=frequency=220:duration=210" \
  -f lavfi -i "sine=frequency=329.63:duration=210" \
  -filter_complex "\
    [0:a][1:a][2:a][3:a][4:a]amix=inputs=5:normalize=0,\
    tremolo=f=0.13:d=0.6,\
    lowpass=f=1600,\
    aecho=0.8:0.55:520|960:0.22|0.12,\
    volume=0.5" \
  -ar 48000 -ac 2 "$BGM"
echo "BGM done: $(stat -c%s "$BGM") bytes"

# ---- 2. 混音 ----
# 注意：不要用 sidechaincompress —— 本机 ffmpeg 8.1.1 在「视频输入 + sidechaincompress」
# 同时存在时会把整条音轨压到 -30 dB 以下（无视频输入时正常）。BGM 本身压低即可。
ffmpeg -y -v error \
  -i "$SRC" \
  -i "$OUT/seg01.mp3" \
  -i "$OUT/seg02.mp3" \
  -i "$OUT/seg03.mp3" \
  -i "$OUT/seg04.mp3" \
  -i "$OUT/seg05.mp3" \
  -i "$OUT/seg06a.mp3" \
  -i "$OUT/seg06b.mp3" \
  -i "$OUT/seg07.mp3" \
  -i "$OUT/seg08.mp3" \
  -i "$OUT/seg09.mp3" \
  -i "$OUT/seg10.mp3" \
  -i "$BGM" \
  -filter_complex "\
    [1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=500|500[a1];\
    [2:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=15200|15200[a2];\
    [3:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=33000|33000[a3];\
    [4:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=46500|46500[a4];\
    [5:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=67500|67500[a5];\
    [6:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=90500|90500[a6];\
    [7:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=96800|96800[a7];\
    [8:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=111000|111000[a8];\
    [9:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=118500|118500[a9];\
    [10:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=153500|153500[a10];\
    [11:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=182000|182000[a11];\
    [a1][a2][a3][a4][a5][a6][a7][a8][a9][a10][a11]amix=inputs=11:normalize=0[narr];\
    [12:a]aformat=sample_rates=48000:channel_layouts=stereo,\
      volume=0.4,lowpass=f=2200,tremolo=f=0.13:d=0.6,\
      aecho=0.8:0.55:520|960:0.22|0.12,\
      afade=t=in:st=0:d=3,afade=t=out:st=204:d=6[bgm];\
    [narr][bgm]amix=inputs=2:normalize=0,alimiter=limit=0.95,atrim=0:210[aout]" \
  -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 48000 -t 210 "$FINAL"
echo "MIX done: $(stat -c%s "$FINAL") bytes"

# ---- 3. 验证 ----
echo "=== STREAMS ==="
ffprobe -v error -show_streams "$FINAL" | grep -E "^codec_type|^codec_name|^sample_rate|^channels|^width|^height" 
echo "=== AUDIO LEVEL (应远高于 -91 dB) ==="
ffmpeg -i "$FINAL" -map 0:a -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
echo "=== DURATION ==="
ffprobe -v error -show_entries format=duration -of csv=p=0 "$FINAL"
