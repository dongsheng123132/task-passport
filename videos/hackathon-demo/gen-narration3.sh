#!/usr/bin/env bash
# seg02 精简 + 新增 seg06a/seg06b（对齐 Act1 的 pack 与电池告警时间点）
set -e
OUT="D:/uking编程/task-passport/videos/hackathon-demo/audio-out"
VOICE="en-US-GuyNeural"

gen() {
  edge-tts --voice "$VOICE" --text "$2" --write-media "$OUT/seg$1.mp3" >/dev/null 2>&1
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/seg$1.mp3")
  echo "seg$1: $d s"
}

gen 02 "Agent A is running a long task. But where does its state live? In a chat transcript. Transcripts are not state. Every protocol assumes both ends are alive. MCP connects tools, not tasks."
gen 06a "Agent A creates a passport for the task: ship the docs site before Friday."
gen 06b "Then packs it into one file — and the laptop battery hits two percent."
