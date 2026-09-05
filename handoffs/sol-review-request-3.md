# Sol 复审请求（第三轮）：仅剩 Arena a1r2 一条，已修

## 背景
第二轮 verdict=REQUEST_CHANGES：NightShift n1/n4 已 APPROVE，仅剩 Arena a1 一条——
schema 多处 string 允许空串/纯空白，运行时 text() 拒绝。现已修完，请求终审。
护照 TP-4JMK-EKR6 state_version=4。TeamSpace/RunCenter 仍未开始，U-King 未碰。

## 审查范围（只看这一个新 commit）
Arena：`D:/uking编程/2origin-harness`，分支 feat/otel-observe，commit `37a0a51`
`fix(arena): Sol a1r2 — schema 与运行时 string 空串语义统一+双向差分`

注意：工作树里 `kernel/kernel.mjs`（M）与 `kernel/store.mjs`、
`kernel/test/persist.test.mjs`（??）是他人此前的未提交改动，与本轮无关，审查时忽略。

## a1r2 修复说明
- 方案选的是 Sol 给的两种之一：在 schema 侧补约束（不动运行时的 text() 严格性）。
- `schemas/arena-result-v1.schema.json`：20 处裸 `{ "type": "string" }` 全部补上
  `minLength: 1` + `pattern: ^(?!\s*$).+`（拒空串/纯空白），与运行时 `text()` 等价。
  覆盖：arena_id、errors[].code/path/message、evidence_command、
  fixture_hashes[].id、arms_planned[].id/provider_ref/model_ref、fixtures_checked[]、
  suite.id/version、runner.file_ref、arms[].id/provider_ref/model_ref、cases[].id、
  sandbox.output_policy/cache_policy、limitations[]。
- `experiments/arena/arena.mjs`：三处原先比 schema 严（纯 typeof 即可处用了 text()
  或反之）统一为 text()——limitations[]、fixtures_checked[]、sandbox 双字段；
  等价映射表注释同步更新。
- 新增测试 `Sol 复审 a1r2`：8 个代表字段 × 空串/纯空白，双向差分——schema 侧判定
  （minLength+pattern 复刻）与 validateResult 同判；非空对照双向通过。
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
