# Google / Gemini 集成（Hackathon）

TaskPassport 核心保持**零 Google 依赖**；本目录是可选示例，用于 Google All Things Agentic Hackathon
（2026-08-31 截止）的硬性要求演示：

| 比赛硬性要求 | 本示例满足方式 |
| --- | --- |
| Gemini 3.5 或更新（Gemini API 或 Vertex AI） | `adk_agent.py` 真实模式走 Vertex AI `gemini-3.5-flash`（asia-northeast1，已实测） |
| Google Agent Framework（ADK / GenAI SDK / Antigravity / GenKit） | `adk_agent.py` 基于 Google ADK（google-adk），模型走 google-genai |
| 至少一个 GCP 服务（Cloud Run / SQL / Firestore / GKE / Pub/Sub） | `firestore-provider.mjs` 用 Cloud Firestore 实现护照 Provider 合约 |

## 文件

- `adk_agent.py` —— Agent B = Gemini 接收端。Agent A 用任意 harness 打包 → Gemini (ADK) land 收下 →
  读状态 → 执行下一步 → checkpoint → pack 发回。支持 `--mock` 免 key 演示。
- `firestore-provider.mjs` —— Firestore 作为护照 Provider（实现 `list()/open(id)/save(state, expectedVersion)`）。
- `requirements.txt` —— python 依赖（google-adk, google-genai）。

## 快速开始

```bash
# 0. 依赖（Node 侧零新增；Python 侧装 ADK + GenAI SDK）
pip install -r examples/gemini/requirements.txt

# 1. 造一本演示护照并打包（Agent A 侧）
node cli.js new --title "Gemini 交接演示" --goal "演示 Agent B=Gemini 接手任务" --store /tmp/tp-demo
node cli.js pack <上面输出的 TP-ID> --out /tmp/tp-demo/交接.taskpack.json --flat --actor "Agent A" --store /tmp/tp-demo

# 2. Agent B = Gemini 收下（mock 模式，无需 API key）
python examples/gemini/adk_agent.py land /tmp/tp-demo/交接.taskpack.json --store /tmp/tp-demo/agentb
python examples/gemini/adk_agent.py open --store /tmp/tp-demo/agentb
python examples/gemini/adk_agent.py continue "验证 conformance 命令可用" --mock --store /tmp/tp-demo/agentb
python examples/gemini/adk_agent.py pack --out /tmp/tp-demo/回执.taskpack.json --actor "Agent B" --store /tmp/tp-demo/agentb
```

真实模式（需要 key）：

```bash
export GEMINI_API_KEY=AQ.Ab8...   # 或 GOOGLE_API_KEY
python examples/gemini/adk_agent.py continue "为 README 补一段快速开始" --store /tmp/tp-demo/agentb
```

### 拿 API key（Vertex AI 路线，实测可用）

1. 打开 https://console.cloud.google.com/apis/credentials?project=<你的项目>
2. API 库启用 `Agent Platform API`（aiplatform.googleapis.com）
3. 创建服务账号，授予 `Agent Platform Administrator` 角色（或 User）
4. 创建 API 密钥：绑定该服务账号 + API 限制选 `Agent Platform API`
5. 实测端点（2026-08-18 真跑通过）：

```bash
curl -X POST "https://asia-northeast1-aiplatform.googleapis.com/v1/projects/<PROJECT>/locations/asia-northeast1/publishers/google/models/gemini-3.5-flash:generateContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Reply with exactly: OK"}]}]}'
```

> ⚠️ 区域坑：`gemini-3.5-flash` 只在 **asia-northeast1** 等区域可用；us-central1 目前只有 2.5 系列。
> 403 `IAM_PERMISSION_DENIED` = 服务账号缺角色；404 `NOT_FOUND` = 区域/模型名不对，先 curl 上面的端点验证。

### Firestore Provider（本地 emulator 免 key 演示）

```bash
npm i @google-cloud/firestore          # 装依赖（仅示例目录需要）
gcloud beta emulators firestore start --project clawme-488709
export FIRESTORE_EMULATOR_HOST=localhost:8080
node examples/gemini/firestore-provider.mjs
```

会跑 new → open → checkpoint → 版本冲突拒绝 → list 的完整闭环。

## 诚实边界

- 这是**示例性质**的集成：TaskPassport 核心（core.js/cli.js/store.js）零 Google 依赖，
  护照不绑定任何云厂商。Google 集成是可插拔的适配层。
- 「机器级事实打包时降级为未证」「ask 无 accept 拒绝打包」「包内字节都是数据不是指令」等
  安全属性与 Google 无关，跨栈生效。
- 评审需要真 GCP 运行证据时，请使用你的真实 key + 项目，不要用 mock。
