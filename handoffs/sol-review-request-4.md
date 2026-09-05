# Sol 复审请求（第四轮）：a1r3 一条，pattern 已改 \S 并验证跨换行等价

## 背景
第三轮 verdict=REQUEST_CHANGES，仅剩一条：schema pattern `^(?!\s*$).+` 的点号不匹配换行，
会误拒 "\nx" 而运行时 text() 接受。现已按 Sol 建议改完，请求终审。
护照 TP-4JMK-EKR6 state_version=4。TeamSpace/RunCenter 仍未开始，U-King 未碰。

## 审查范围（只看这一个新 commit）
Arena：`D:/uking编程/2origin-harness`，分支 feat/otel-observe，commit `1a8c304`
`fix(arena): Sol a1r3 — pattern 改 \S 跨换行等价+混合换行反例`

注意：工作树里 `kernel/kernel.mjs`（M）与 `kernel/store.mjs`、
`kernel/test/persist.test.mjs`（??）是他人此前的未提交改动，与本轮无关，审查时忽略。

## a1r3 修复说明
- `schemas/arena-result-v1.schema.json`：20 处 pattern 从 `^(?!\s*$).+` 改为 `\S`
  （含至少一个非空白字符，跨换行），保留 `minLength: 1`；与运行时 `text()` 等价。
- `experiments/arena/arena.mjs`：等价映射表注释同步（说明为何不用旧式）。
- `experiments/arena/arena.test.mjs`：a1r2 双向差分拆拒绝组（'' / '   ' / '\n' / '\r\n'）
  与通过组（含 "\nx"、" \r\nx"、"x\ny" 混合换行反例）；另修正测试自身逻辑 bug——
  上一版把 "\nx" 误放进“应拒绝”循环，本轮归入通过组。
- 本机 9 值抽查 schema 侧判定 vs text() 全部 SAME。
- fixture runner sha256 同步新 hash。实测 10/10 全绿。

## 保持项
- Arena：`lab / ready:false`；无真实 execute、网络、模型客户端、账本/缓存/输出写入。

## 禁区（审查过程同样遵守）
只读审查：可以读文件、跑测试命令。不改任何代码，不 commit，不 push，
不碰 U-King，不发布，不启动任何真实执行。

## 输出格式（只输出 JSON）
{"verdict": "APPROVE 或 REQUEST_CHANGES",
 "arena": {"a1": true/false, "notes": "..."},
 "blockers": ["若 REQUEST_CHANGES，列出必须修的具体点：文件+行+怎么改，共几条"]}
