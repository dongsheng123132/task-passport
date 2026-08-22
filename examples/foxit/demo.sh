#!/usr/bin/env bash
# demo.sh — Task Passport × Foxit eSign 一键演示（全 mock，免凭据）
# 在 Windows git-bash / macOS / Linux 下直接跑：
#   bash examples/foxit/demo.sh            # 完整 happy path
#   bash examples/foxit/demo.sh --no-approval   # 反例①：没人批准就去签 → 必须退出码 3
#   bash examples/foxit/demo.sh --tamper        # 反例②：批准后文档被改 → 必须退出码 2
#
# 核心演示点（本仓库最原创的一条）：
# 用**两个独立 store**（.demo-foxit/agent-store 和 human-store）模拟两台机器。
# agent 在自己机器上验过的事实，pack 出门时被封存为未证，land 到人那边
# review show 打印出来就是「在你这台机器上未证」——同一个 store 演不出这个。
#
# 注意（Windows MSYS 坑，gemini demo 的教训）：不用 mktemp -d，/tmp 是 MSYS 虚拟路径，
# 传给 node 会变成不存在的 D:\tmp\...；全部用仓库内相对路径。结束自动清理。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DEMO=".demo-foxit"
rm -rf "$DEMO"
mkdir -p "$DEMO/agent-store" "$DEMO/human-store" "$DEMO/out"
trap 'rm -rf "$DEMO"' EXIT

AGENT_STORE="$DEMO/agent-store"
HUMAN_STORE="$DEMO/human-store"
OUT="$DEMO/out"

agent() { node examples/foxit/agent.mjs "$@"; }
review() { node examples/foxit/review.mjs "$@"; }

json_field() { # json_field <field> —— 从 stdin 的 JSON 里取字段
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d)[process.argv[1]]))" "$1"
}

TASK="为 Acme Co. 起草咨询服务合同，生成 PDF 自检后送客户签署"

echo "===== [1/6] agent: plan —— 开一本任务护照 ====="
PLAN_OUT="$(agent plan --task "$TASK" --store "$AGENT_STORE")"
echo "$PLAN_OUT"
TP="$(echo "$PLAN_OUT" | json_field passport_id)"
echo "护照 ID: $TP"

echo
echo "===== [2/6] agent: draft —— 可逆的活自己干，到签名边界停下 ====="
agent draft --passport "$TP" --store "$AGENT_STORE" --out "$OUT" --mock

echo
echo "===== [3/6] 人: review show —— 看清 agent 做了什么、哪些在你这台机器上未证 ====="
review show "$OUT/for-review.taskpack.json"

# ---------- 反例①：没有人批准就去签 ----------
if [ "${1:-}" = "--no-approval" ]; then
  echo
  echo "===== 反例①：跳过人这一步，直接 sign ====="
  set +e
  agent sign --passport "$TP" --store "$AGENT_STORE" --out "$OUT" --mock \
    --signer-email "jane.doe@acme.example" --signer-name "Jane Doe"
  RC=$?
  set -e
  if [ "$RC" -eq 3 ]; then
    echo "✅ PASS：没有人批准，agent 拒绝送签（退出码 $RC = 3）"
    exit 3
  fi
  echo "❌ FAIL：期望退出码 3，实际 $RC"
  exit 1
fi

echo
echo "===== [4/6] 人: approve —— 批准，打回执（带上他看到的那份 PDF 的 sha256）====="
review approve "$OUT/for-review.taskpack.json" \
  --into-store "$HUMAN_STORE" --actor "张老师" --out "$OUT"

echo
echo "===== [5/6] 回执 land 回 agent 的护照（答案合并回原 ask）====="
node cli.js land "$OUT/receipt.taskpack.json" --into "$TP" --store "$AGENT_STORE"
echo "回执已 land 回 $TP"

# ---------- 反例②：批准之后文档被改 ----------
if [ "${1:-}" = "--tamper" ]; then
  echo
  echo "===== 反例②：批准之后偷偷改 out/contract.pdf，再让 agent 签 ====="
  printf 'tampered-by-demo' >> "$OUT/contract.pdf"
  echo "（已向 $OUT/contract.pdf 追加字节）"
  set +e
  agent sign --passport "$TP" --store "$AGENT_STORE" --out "$OUT" --mock \
    --signer-email "jane.doe@acme.example" --signer-name "Jane Doe"
  RC=$?
  set -e
  if [ "$RC" -eq 2 ]; then
    echo "✅ PASS：批准的是旧版本，agent 拒绝送签（退出码 $RC = 2）"
    exit 2
  fi
  echo "❌ FAIL：期望退出码 2，实际 $RC"
  exit 1
fi

echo
echo "===== [6/6] agent: sign —— 四道闸门全过，才调 eSign ====="
agent sign --passport "$TP" --store "$AGENT_STORE" --out "$OUT" --mock \
  --signer-email "jane.doe@acme.example" --signer-name "Jane Doe"

echo
echo "✅ 演示完成：可逆的活 agent 干；不可逆的送签，人先批、版本核对一致，才落笔。"
echo "   两台机器两个 store：agent 验过的事实到了人那边显示为未证，回执带 sha256 回家。"
