#!/usr/bin/env bash
# 生成英文旁白分段音频（edge-tts），每段一个文件，供 ffmpeg 按时间轴摆放
set -e
OUT="D:/uking编程/task-passport/videos/hackathon-demo/audio-out"
mkdir -p "$OUT"
VOICE="en-US-GuyNeural"

gen() { # $1=seg编号 $2=文本
  edge-tts --voice "$VOICE" --text "$2" --write-media "$OUT/seg$1.mp3" >/dev/null 2>&1
  echo "seg$1 done: $(stat -c%s "$OUT/seg$1.mp3" 2>/dev/null || stat -f%z "$OUT/seg$1.mp3") bytes"
}

gen 01 "Your agent was mid-task. The laptop closed. The model switched. Agents shouldn't restart from zero."
gen 02 "Agent A is running a long task. Building assets, checking links, preparing to deploy. But where does its state live? In a chat transcript. And transcripts are not state. Every agent protocol assumes both ends are alive. A2A needs a live peer. MCP connects tools, not tasks."
gen 03 "Then the laptop closes. The agent is killed. The machine is different. The task dies with the agent."
gen 04 "Task Passport is the durable state of a long-running task. Versioned. Locked. It lives outside any single harness. First: a passport holds the goal, current state, verified facts, decisions, and next steps. It stays at home, keeps a version, and rejects stale writes."
gen 05 "Second: pack. Seal that state into one portable file. A taskpack, or a flat taskpack JSON. Verified machine facts degrade to unproven at pack time. Third: land. Any harness — Gemini, Claude, Codex — reads the file and continues. Not from zero. From the verified state."
gen 06 "Here's the full flow. Agent A — Claude Code — creates a passport for a real task: ship the docs site before Friday. Goal, current state, next steps. Then it packs everything into one file: handoff.taskpack.json. And then... laptop battery at two percent."
gen 07 "Shutdown. Agent A is gone. The machine is different. All that survives is that one file."
gen 08 "Now Agent B — Gemini, running on Google ADK with Vertex AI, gemini three point five flash — lands the file. It reads the state, sees the goal and next steps, continues the task, fixes the asset paths, checkpoints, and packs a receipt back. State version one, to two, to three. The task never restarted from zero."
gen 09 "And here's the proof: Gemini three point five is really running on Vertex AI. The model replies: I am alive. Google Agent Framework: ADK and the GenAI SDK. Google Cloud: Firestore provider, Vertex AI runtime. The receipt lands anywhere."
gen 10 "All hackathon requirements met. Gemini three point five or newer. Google Agent Framework. And a Google Cloud service. Task Passport — on npm, zero runtime dependencies, an MCP server built in, seventy-eight tests, MIT licensed. Spec at taskpack dot org. Code on GitHub. Agents shouldn't restart from zero."
