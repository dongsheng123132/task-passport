# Sol 复审请求：TP-4JMK-EKR6 Arena + NightShift（只读审查）

## 背景
任务护照 TP-4JMK-EKR6：把 U-King 实验能力逐条迁入本源 AI 计算机。
本轮只做了 Arena 与 NightShift 的"当前必须修复"，做完即停，等你复审。
TeamSpace / RunCenter 未开始，绝不提前动。U-King 主线未碰。

## 审查范围（只看这两个 commit，不看其他）
1. Arena：`D:/uking编程/2origin-harness`，分支 feat/otel-observe，commit `c66c578`
   `fix(arena): add validateResult with deep unknown/secret field rejection`
2. NightShift：`D:/uking编程/ShadowOS-nightshift`，分支 feat/nightshift-protocol，commit `ebea406`
   `fix(nightshift): freeze protocol — harden expires_at/intent_ref/evidence_refs`

注意：2origin-harness 工作树里 `kernel/fixtures/demo-trace.json` 与 `team-trace.json`
有他人此前的未提交改动（换行符 churn），与本轮无关，审查时忽略。

## Arena 验收标准（必须全满足才算过）
- A1：公开 result JSON Schema（`schemas/arena-result-v1.schema.json`）与运行时
  `validateResult`（`experiments/arena/arena.mjs`）同形、同样严格，且 dryRun 实际调用了 schema/运行时校验。
- A2：`resolved_plan` 等深层对象拒绝 unknown / secret 字段；测试里有"在旧实现下会失败"的反向用例。
- A3：`node --test experiments/arena/arena.test.mjs` 全绿（声称 8/8，请亲手重跑验证）。
- A4：保持 `lab / ready:false`；无真实 execute、无网络、无模型客户端、无账本/缓存/输出写入。

## NightShift 验收标准（必须全满足才算过）
- N1：`execute-request` schema 若 required `plan`，必须在 `properties` 中定义对应形状；
  合法请求应先通过 schema、再被 `EXECUTION_DISABLED` 拒绝（fail-closed，不断错链）。
- N2：无效 `expires_at` 必须拒绝，不能经 NaN 绕过。
- N3：unsafe handoff 的拒绝响应不得回显原始 `evidence_refs`。
- N4：`intent_ref` 仅允许保守不透明引用；URL、命令式/路径式输入必须拒绝。
- N5：有"在旧实现下会失败"的反向测试；`node --test runtime/nightshift/nightshift.test.mjs`
  全绿（声称 8/8，请亲手重跑验证）。
- N6：无 CLI、shell/命令执行、网络、模型调用、状态写入；`execute` 永远 `EXECUTION_DISABLED`。

## 禁区（审查过程同样遵守）
只读审查：可以读文件、跑测试命令。不改任何代码，不 commit，不 push，
不碰 U-King，不发布，不启动任何真实执行。

## 输出格式（只输出 JSON，不要长篇大论）
{"verdict": "APPROVE 或 REQUEST_CHANGES",
 "arena": {"a1": true/false, "a2": true/false, "a3": "实测 x/y", "a4": true/false, "notes": "..."},
 "nightshift": {"n1": true/false, "n2": true/false, "n3": true/false, "n4": true/false, "n5": "实测 x/y", "n6": true/false, "notes": "..."},
 "blockers": ["若 REQUEST_CHANGES，列出必须修的具体点：文件+行+怎么改，共几条"]}
