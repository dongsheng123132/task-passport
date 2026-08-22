#!/usr/bin/env bash
# 精简版 seg02 / seg05 / seg07 / seg08，对齐场景时间轴
set -e
OUT="D:/uking编程/task-passport/videos/hackathon-demo/audio-out"
VOICE="en-US-GuyNeural"

gen() {
  edge-tts --voice "$VOICE" --text "$2" --write-media "$OUT/seg$1.mp3" >/dev/null 2>&1
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/seg$1.mp3")
  echo "seg$1: $d s"
}

gen 02 "Agent A is running a long task. Building assets, checking links, preparing to deploy. But where does its state live? In a chat transcript. Transcripts are not state. Every protocol assumes both ends are alive. MCP connects tools, not tasks."
gen 05 "Second: pack. A taskpack, or a flat taskpack JSON. Verified machine facts degrade to unproven at pack time. Third: land. Any harness — Gemini, Claude, Codex — reads the file and continues. Not from zero. From the verified state."
gen 07 "Shutdown. Agent A is gone. All that survives is that one file."
gen 08 "Now Agent B — Gemini, on Google ADK with Vertex AI, gemini three point five flash — lands the file. Reads the state, continues the task, checkpoints, packs a receipt. State version one, to two, to three. The task never restarted from zero."
