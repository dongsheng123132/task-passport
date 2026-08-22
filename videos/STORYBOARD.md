# Task Passport — Hackathon Demo Video 分镜脚本

比赛：Google All Things Agentic Hackathon (Taskmaster 赛道)
时长目标：~3 分 30 秒（210 秒），上限 4 分钟
格式：1920x1080 横屏，30fps
语言：英文（旁白/字幕），满足「English or subtitled」

## 硬性要求核对
- [ ] Gemini 3.5 or newer：真实演示 Agent B = Gemini（Vertex AI gemini-3.5-flash, asia-northeast1）
- [ ] Google Agent Framework：ADK（google-adk）
- [ ] GCP 服务：Firestore provider + Vertex AI
- [ ] 视频公开（YouTube）非 private/unlisted
- [ ] 展示 GCP 后端证据（Vertex API 响应 / GCP console）

## 分镜（时间码）

### Scene 1 — Hook (0:00-0:15) [remotion 动画]
- 黑底白字逐行打出：
  "Your agent was mid-task. The laptop closed. The model switched."
  "AGENTS SHOULDN'T RESTART FROM ZERO."
- 音乐：低音 pad 起

### Scene 2 — Problem (0:15-0:45) [remotion 动画]
- 可视化：Agent A 在跑一个长任务（进度条/日志流）
- 突发：红屏「CRASH」/「SHUTDOWN」/「MODEL SWITCHED」
- 文字：State lived in a chat transcript. Transcripts are not state.
- 文字：Every agent protocol assumes both ends are alive. A2A needs a live peer. MCP connects tools, not tasks.
- 结论行：The task dies with the agent.

### Scene 3 — Solution (0:45-1:30) [remotion 动画 + 简短录屏]
- 文字：Task Passport — the durable state of a long-running task.
- 三个概念动画：
  1. Passport：versioned, locked, lives in a store
  2. pack：seal state + verified facts + decisions + next steps into ONE file (.taskpack / .taskpack.json)
  3. land：any harness reads it and continues — not from zero
- 关键安全属性：verified facts degrade at pack time（机器级事实打包时降级为未证）
- 简短终端录屏：node cli.js new / pack（2-3 秒）

### Scene 4 — Core Demo: Agent A -> Crash -> Agent B = Gemini (1:30-3:00) [真实录屏 ★核心]
- 4a (1:30-1:50)：终端——Agent A 造护照、pack 成 交接.taskpack.json
  - node cli.js new --title "Ship the docs site" ...
  - node cli.js pack TP-XXX --out handoff.taskpack.json --flat --actor "Agent A"
- 4b (1:50-2:00)：动画过渡——"Agent A is gone. Laptop closed. Machine different."
- 4c (2:00-2:40)：终端——Agent B = Gemini（ADK agent, mock 无 key 也能跑，但此处展示真实调用）
  - python examples/gemini/adk_agent.py land handoff.taskpack.json --store store-b
  - python examples/gemini/adk_agent.py open
  - python examples/gemini/adk_agent.py continue "..." --mock  （展示 checkpoint 版本递增）
  - python examples/gemini/adk_agent.py pack --out receipt.taskpack.json
- 4d (2:40-3:00)：GCP 证据（浏览器录屏）
  - curl 调 Vertex AI generateContent 返回 JSON（gemini-3.5-flash OK）
  - GCP console：API 已启用列表（Gemini API + Agent Platform API）、服务账号 hackathon-gemini、API 密钥页

### Scene 5 — Compliance + Value (3:00-3:30) [remotion 动画]
- 三个打勾：
  ✓ Gemini 3.5+ via Vertex AI (gemini-3.5-flash, asia-northeast1)
  ✓ Google Agent Framework: ADK + GenAI SDK
  ✓ Google Cloud: Firestore provider + Vertex AI
- 附加价值：
  - npm 可装：task-passport@0.3.0（零运行时依赖，MCP server 内置）
  - 78 tests, conformance 10 项检查
  - MIT 开源，taskpack.org 规范
- CTA：github.com/dongsheng123132/task-passport

## 素材清单
1. [ ] remotion 动画（Scene 1/2/3/5）：videos/hackathon-demo/
2. [ ] 终端录屏（Scene 3 短 + Scene 4 核心）：ffmpeg gdigrab
3. [ ] 浏览器录屏（GCP console + curl）：ffmpeg gdigrab window capture
4. [ ] 背景音乐：无版权（可选，或用静音+字幕）
5. [ ] 字幕：英文 burned-in（remotion 或 ffmpeg）

## 技术栈
- remotion (React) — 动画/标题/字幕
- ffmpeg 8.1.1 — 录屏（gdigrab）+ 合成（concat/xfade）
- Node cli.js + python adk_agent.py — 真实演示
- 上传：YouTube（用户 Google 账号 hefangsheng@gmail.com）
