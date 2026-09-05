# 本源 AI 计算机迁移 — Arena & NightShift & TeamSpace 修复报告

生成时间: 2026-09-05 01:41 UTC（Arena/NightShift 首轮修复段，以下保留原文）
更新时间: 2026-09-05（补 TeamSpace 段、两线的后续 Sol 复审 commit、消除与护照 v6 的漂移）
任务护照: TP-4JMK-EKR6（当时 state_version 3，现已推进到 v6）
执行者: Hermes (deepseek-v4-pro via OpenRouter)

> **本次更新说明**：本文件此前（state_version 3 时写）「未完成」一节写着
> 「TeamSpace: 未开始（等待 Sol 批准）」，但 TeamSpace 只读接头实际已在
> `ShadowOS-nightshift` 落地三个 commit（`2f044f9`/`e97787e`/`3822907`），
> 即**代码先于批准落地**。主会话 2026-09-05 复核代码、重跑测试（11/11 pass）后
> **追认为已批准**（三个 commit 均为只读 fail-closed 接头，未碰 U-King，符合既定
> 路线第 4 条线范围），本文件据此更新，不再维持与 git 事实不符的状态描述。
> 同时补上 Arena（`c66c578`→`1a8c304`）与 NightShift（`ebea406`→`1b8444d`）
> 后续几轮 Sol 复审修复，两者均已 APPROVE。

---

## Arena 修复 (2origin-harness, feat/otel-observe)

**Commit**: `c66c578`

### 修复内容

1. **validateResult 运行时校验函数**
   - 新增 `validateResult()` 函数，与 `schemas/arena-result-v1.schema.json` 同形同样严格
   - `dryRun()` 在返回前对两种路径（rejected / simulated）均执行自检，抛异常阻止 schema/runtime 漂移产物逃逸

2. **Result Schema 深化**
   - `arena-result-v1.schema.json` 全面重写：每一层嵌套对象加 `additionalProperties: false`
   - `resolved_plan` 深层展开完整子 schema（suite/runner/scoring/arms/cases/budget/sandbox）
   - `evidence` 内部对象严格限字段
   - `execution` 内部 `arms_planned` 严密校验

3. **反向测试** (新增 1 条，总计 8 条)
   - 顶层 unknown 字段拒绝
   - evidence/budget/execution 内部 unknown 字段拒绝
   - resolved_plan.arms 深层 secret 字段 (api_key) 拒绝
   - resolved_plan.budget 深层 unknown 字段拒绝
   - resolved_plan.arms 内部 unknown 字段拒绝
   - resolved_plan.cases 内部 unknown 字段拒绝

### 测试结果

```
node --test experiments/arena/arena.test.mjs
8/8 pass
```

### 不变项

- `lab` maturity, `ready: false`
- 无真实 execute、网络、模型客户端、账本/缓存/输出写入
- registry.json 未改

---

## NightShift 修复 (ShadowOS-nightshift, feat/nightshift-protocol)

**Commit**: `ebea406`

### 修复内容

1. **expires_at NaN 拒绝**
   - `validateExecuteRequest` 新增显式 `Date.parse()` → `NaN` 检查，在旧 `APPROVAL_EXPIRED` 前拦截
   - 错误码: `APPROVAL_EXPIRES_INVALID`

2. **intent_ref 保守约束**
   - `validatePlan` 内对 `intent_ref` 加双闸：URL 检测（`scheme://`）→ `INTENT_REF_URL`，命令字符检测（`;&|<backtick>$(){}<>#!~*?`）→ `INTENT_REF_COMMAND_LIKE`
   - 合法不透明引用（如 `fixture/observe-health`）不受影响

3. **unsafe handoff 拒绝不回显 evidence_refs**
   - `makeHandoff` 中 `UNSAFE_EVIDENCE_REF` 分支已移除 `evidence_refs` 回显

4. **execute-request schema 补 plan 定义**
   - `nightshift-execute-request-v1.json` 的 `plan` 属性添加 `$ref` 指向 `nightshift-plan-v1.json`，合法请求可通过 schema 后再被 `EXECUTION_DISABLED` 拒绝

5. **反向测试** (新增 3 条，总计 8 条)
   - NaN expires_at 稳定拒绝 + 合法请求仍入 EXECUTION_DISABLED
   - URL/管道/反引号 intent_ref 拒绝 + 合法 opaque 引用通过
   - unsafe handoff 拒绝不泄露 evidence_refs + 合法 handoff 正常携带

### 测试结果

```
node --test runtime/nightshift/nightshift.test.mjs
8/8 pass
```

### 不变项

- `EXECUTION_DISABLED` 永远生效（合法请求到达即拒）
- 无 CLI、shell/命令执行、网络、模型调用、状态写入
- 测试文件 fixture 无改动

---

## TeamSpace 只读接头 v1（ShadowOS-nightshift, feat/nightshift-protocol）

**Commit 链**：`2f044f9`（本体）→ `e97787e`（Sol 审稿漂移修复）→ `3822907`（T3 改真 validator）

### 内容

- 落点：`agentteams/teamspace-readonly.mjs` + `schemas/teamspace-snapshot-v1.json`
- 只读 `getSnapshot` / `getIntegrity`，包装 `coordination.mjs`（0.5）
- 只暴露 `{spec, tasks, history_len, integrity}`，不给历史明细、不给 board 路径、不给写动作
- 不迁移 U-King 数据、不双写；U-King 的 TeamSpace 页（localStorage 演示）原样保留

### Sol 审稿修复轨迹

- R5：`claimed_by` 等三字段 schema 缺 `minLength` + `\S`，与运行时不等价 → `e97787e` 补齐
- R6：T3 是手写复刻的假 validator，非真 schema 校验 → `3822907` 改为内联 Draft 子集校验，双向差分
- 终审：`APPROVE`

### 测试结果（主会话 2026-09-05 复核重跑）

```
node agentteams/verify-teamspace-readonly.mjs
11/11 pass
```
回归：`coordination` 38/38、`nightshift` 10/10 全绿。

---

## 三条线状态汇总

| 线         | Commit   | 测试   | ready      | 禁区                  |
|-----------|----------|--------|------------|----------------------|
| Arena     | 1a8c304  | 10/10 ✓ | false      | dry-run only, lab     |
| NightShift | 1b8444d | 10/10 ✓ | EXECUTION_DISABLED | fail-closed |
| TeamSpace | 3822907 | 11/11 ✓ | 只读接头 | fail-closed，无写动作 |

## 未完成

- RunCenter: 未开始（依赖 TeamSpace 只读接头通过——已通过，可开工）
- 教材驾驶舱: 保留分支证据，未合 main

## 工作树状态

- 2origin-harness (feat/otel-observe): 仅受控 commit，无他人未提交改动
- ShadowOS-nightshift (feat/nightshift-protocol): 仅受控 commit，工作树干净
- 无 push、无部署、无 U-King 修改

## 下一步

1. **RunCenter 已获主会话批准开工**（2026-09-05）：先建受管、版本化、安全的本源 OTLP
   artifact 宿主与只读 import/inspect 契约，之后才谈 collector；禁止读开发机静态目录或
   未跟踪 viewer，禁止开放公网 collector，synthetic 指标须显式标注。完成前不得隐藏
   U-King 的 RunCenter 页。
2. U-King 侧的 RunCenter/TeamSpace 页摘除已在 U-King 仓单独处理（两页均为纯前端原型，
   后端 0 行/0 动作，摘除不影响本迁移路线，也不构成「已迁回」）。