# Sol 复审请求（第二轮）：TP-4JMK-EKR6 三条 blocker 已修

## 背景
首审 verdict=REQUEST_CHANGES，三条 blocker。现已按条修完，请求复审。
护照 TP-4JMK-EKR6 state_version=4。TeamSpace/RunCenter 仍未开始，U-King 未碰。

## 审查范围（只看这两个新 commit）
1. Arena：`D:/uking编程/2origin-harness`，分支 feat/otel-observe，commit `b469da4`
   `fix(arena): Sol a1 — validateResult 与公开 schema 等价收紧`
2. NightShift：`D:/uking编程/ShadowOS-nightshift`，分支 feat/nightshift-protocol，commit `1b8444d`
   `fix(nightshift): Sol n1+n4 — schema 绝对 $id/$ref + intent_ref 名字空间收紧`

注意：2origin-harness 工作树里 `kernel/kernel.mjs`（M）与 `kernel/store.mjs`、
`kernel/test/persist.test.mjs`（??）是他人此前的未提交改动，与本轮无关，审查时忽略。

## 首审 blocker 逐条回应
- B1（Arena a1）：`experiments/arena/arena.mjs` 的 `validateResult` 已补
  required/type/pattern/minimum/const/items 全检——suite/runner/scoring 类型+hash、
  arms/cases items 必含字段、budget 八字段+timeout/concurrency>=1+currency USD、
  sandbox 双 string、limitations/fixtures_checked 全 string、NaN 上界 isFinite 拒掉；
  另 seed 不在 schema required 内，缺 seed 不报错（纠正上一版误判）。
  新增反向测试 `Sol 复审 a1`：空 suite/runner/sandbox、空 arm、scoring 偏离 const、
  currency/上界非法、非法 hash、非 string limitations、缺 required arms——旧实现只查
  unknown 会放行，现一律拒绝。实测 9/9 全绿。
- B2（NightShift n1）：`schemas/nightshift-execute-request-v1.json` 与
  `schemas/nightshift-plan-v1.json` 改绝对规范 `$id`
 （https://2origin.example/schemas/…），plan `$ref` 指绝对 URI；
  亲手用 ajv@8（Draft 2020-12）验证 COMPILE_OK 且合法请求 VALID_REQ_PASS=true。
  新增测试 `Sol 复审 n1`：零依赖内联 Draft 2020-12 子集校验（$ref 可解析断言在内），
  合法请求先过 schema、再走运行时到达 EXECUTION_DISABLED。实测 10/10 全绿。
- B3（NightShift n4）：`runtime/nightshift/nightshift.mjs` 的 intent_ref 收紧为
  保守不透明引用——必须以 fixture/intent/check/probe 名字空间打头 + 小写 slug
  （段 1–64 字符、2–8 段、禁空段/./.. /反斜杠）；旧 INTENT_REF_COMMAND_LIKE 并入
  INTENT_REF_OPAQUE，INTENT_REF_URL 保留。新增测试 `Sol 复审 n4`：
  scripts/run.ps1、反斜杠路径、cmd /c whoami、powershell -Command …、大写/空格/
  空段/裸 slug 一律拒绝，合法名字空间引用通过。旧实现会放行上述全部。

## 保持项（请一并确认）
- Arena：`lab / ready:false`；无真实 execute、网络、模型客户端、账本/缓存/输出写入。
- NightShift：无 CLI、shell/命令执行、网络、模型调用、状态写入；`execute` 永远 `EXECUTION_DISABLED`。

## 禁区（审查过程同样遵守）
只读审查：可以读文件、跑测试命令。不改任何代码，不 commit，不 push，
不碰 U-King，不发布，不启动任何真实执行。

## 输出格式（只输出 JSON）
{"verdict": "APPROVE 或 REQUEST_CHANGES",
 "arena": {"a1": true/false, "notes": "..."},
 "nightshift": {"n1": true/false, "n4": true/false, "notes": "..."},
 "blockers": ["若 REQUEST_CHANGES，列出必须修的具体点：文件+行+怎么改，共几条"]}
