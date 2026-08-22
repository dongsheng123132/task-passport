#!/usr/bin/env bash
# demo-video-recording.sh — Scene 4 真实演示的录屏剧本
# 慢速、带停顿、输出清晰，专为录屏设计。跑之前先 source 好 GEMINI_API_KEY。
#
# 用法：
#   export GEMINI_API_KEY='AQ.Ab8...'
#   bash videos/demo-video-recording.sh
#
# 演示叙事：Agent A 造护照打包 -> 崩溃 -> Agent B = Gemini 收下继续 -> 封包回传 -> GCP 证据

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
D=".video-demo"
rm -rf "$D"; mkdir -p "$D/store-a" "$D/store-b" "$D/out"

PAUSE=2.2   # 每条命令之间的停顿（秒），录屏观感
run() {
  echo; echo "──────────────────────────────────────────────────────────────"
  echo "\$ $*"
  echo "──────────────────────────────────────────────────────────────"
  sleep 1
  "$@"
  sleep "$PAUSE"
}

echo "████  ACT 1 — Agent A 开始工作（Claude Code / Codex / 任意 harness）████"
sleep 1

run node cli.js new --title "Ship the docs site before Friday" \
  --goal "Deploy the new docs site to production with zero broken links" \
  --current-state "Draft written. Build script failing on asset paths." \
  --next-step "Fix asset paths, run link checker, deploy" \
  --store "$D/store-a"

TP_A=$(node cli.js list --store "$D/store-a" 2>/dev/null | python -c "import json,sys; print(json.load(sys.stdin)['passports'][-1]['passport_id'])")

echo; echo "── Agent A 干到一半……突然，笔记本合上了。──"; sleep 2.5

run node cli.js pack "$TP_A" --out "$D/out/handoff.taskpack.json" --flat \
  --actor "Agent A" --note "Laptop dying, take over please" --store "$D/store-a"

echo; echo "████  ACT 2 — 换了一台机器，Agent B = Gemini（ADK + Vertex AI）████"
sleep 1

run python examples/gemini/adk_agent.py land "$D/out/handoff.taskpack.json" --store "$D/store-b"

run python examples/gemini/adk_agent.py open --store "$D/store-b"

run python examples/gemini/adk_agent.py continue "Fix the asset paths and run the link checker" --mock --store "$D/store-b"

run python examples/gemini/adk_agent.py pack --out "$D/out/receipt.taskpack.json" --actor "Agent B" --store "$D/store-b"

echo; echo "████  ACT 3 — GCP 证据：Gemini 3.5 真的在 Vertex AI 上跑 ████"
sleep 1

if [ -n "${GEMINI_API_KEY:-}" ]; then
  echo; echo "\$ curl -X POST https://asia-northeast1-aiplatform.googleapis.com/v1/projects/clawme-488709/locations/asia-northeast1/publishers/google/models/gemini-3.5-flash:generateContent"
  echo "   -H 'x-goog-api-key: ***' -d '{contents:[{role:user, parts:[{text:\"Reply with exactly: I am alive\"}]}]}'"
  echo
  curl -s -m 45 -X POST "https://asia-northeast1-aiplatform.googleapis.com/v1/projects/clawme-488709/locations/asia-northeast1/publishers/google/models/gemini-3.5-flash:generateContent" \
    -H "Content-Type: application/json" -H "x-goog-api-key: $GEMINI_API_KEY" \
    -d '{"contents":[{"role":"user","parts":[{"text":"Reply with exactly: I am alive"}]}]}' \
    | python -c "
import json,sys
d = json.load(sys.stdin)
c = d.get('candidates',[{}])[0].get('content',{}).get('parts',[{}])[0].get('text','')
u = d.get('usageMetadata',{})
print(json.dumps({'model': d.get('modelVersion','gemini-3.5-flash'),
                  'reply': c,
                  'prompt_tokens': u.get('promptTokenCount'),
                  'total_tokens': u.get('totalTokenCount')}, indent=2))
"
  sleep 2
else
  echo "(GEMINI_API_KEY 未设置，跳过真实调用——录屏前 export 好)"
fi

echo
echo "████  DONE — 完整链路：Agent A → TaskPack → Agent B(Gemini) → 回传 ████"
echo "回执包在: $D/out/receipt.taskpack.json"
