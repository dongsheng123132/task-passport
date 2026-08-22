#!/usr/bin/env bash
# demo.sh — Task Passport × Gemini 一键演示（mock 模式，无需 API key）
# 在 Windows git-bash / macOS / Linux 下直接跑：
#   bash examples/gemini/demo.sh
#
# 流程：造护照 -> pack -> Agent B (ADK, mock) land -> open -> continue -> pack 回传
# 证明状态延续：continue 之后 open 能看到新 checkpoint 版本号/状态文本变化。
#
# 注意（Windows MSYS 坑）：不要用 mktemp -d —— /tmp 是 MSYS 虚拟路径，
# 传给 node/python 会被转成不存在的 D:\tmp\... 而报 ENOENT。
# 这里全部用仓库内的相对路径（node 的 cwd 就是仓库根）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TMP=".demo-tmp"
rm -rf "$TMP"
mkdir -p "$TMP/store-a" "$TMP/store-b" "$TMP/out"
trap 'rm -rf "$TMP"' EXIT

echo "===== [1/6] Agent A：造一本演示护照 ====="
NEW_OUT="$(node cli.js new --title "Gemini 交接演示" \
  --goal "演示 Agent B=Gemini 接手任务并继续执行" \
  --current-state "第一步已完成：仓库克隆。" \
  --next-step "Agent B 接手后验证 conformance。" \
  --store "$TMP/store-a")"
echo "$NEW_OUT" | python -m json.tool
TP_ID="$(echo "$NEW_OUT" | python -c "import json,sys; print(json.load(sys.stdin)['passport_id'])")"
echo "护照 ID: $TP_ID"

echo
echo "===== [2/6] Agent A：pack 成 TaskPack 文件（扁平版，零安装可读）====="
node cli.js pack "$TP_ID" --out "$TMP/out/交接.taskpack.json" --flat \
  --actor "Agent A" --note "演示交接" --store "$TMP/store-a"
echo "已生成: $TMP/out/交接.taskpack.json"

echo
echo "===== [3/6] Agent B = Gemini (ADK, mock)：land 收下 ====="
python examples/gemini/adk_agent.py land "$TMP/out/交接.taskpack.json" --store "$TMP/store-b"
echo "Agent B 收下并开了一本新护照"

echo
echo "===== [4/6] Agent B：open 读当前状态 ====="
python examples/gemini/adk_agent.py open --store "$TMP/store-b" | python -c "
import json,sys
d = json.load(sys.stdin)
print('passport:', d['passport_id'], '| version:', d['state_version'])
print('goal:', d['state']['goal'])
print('current_state:', d['state']['current_state'])
"

echo
echo "===== [5/6] Agent B：continue 执行下一步（mock，不调 Google API）====="
python examples/gemini/adk_agent.py continue "验证 conformance 命令可用" --mock --store "$TMP/store-b" | python -c "
import json,sys
d = json.load(sys.stdin)
print('checkpoint 后 version:', d['state_version'])
print('current_state:', d['state']['current_state'])
"

echo
echo "===== [6/6] Agent B：pack 回传，Agent A land 收尾 ====="
python examples/gemini/adk_agent.py pack --out "$TMP/out/回执.taskpack.json" --actor "Agent B" --store "$TMP/store-b"
echo "回执包: $TMP/out/回执.taskpack.json"
echo
echo "✅ 演示完成：状态从 Agent A 延续到 Agent B，没有 restart from zero。"
echo "   回执包可在任意装了 task-passport 的机器上 land 收下继续。"
