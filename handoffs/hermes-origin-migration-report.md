# 本源 AI 计算机迁移 — Arena & NightShift 修复报告

生成时间: 2026-09-05 01:41 UTC
任务护照: TP-4JMK-EKR6 (state_version 3)
执行者: Hermes (deepseek-v4-pro via OpenRouter)

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

## 两条线状态汇总

| 线         | Commit   | 测试   | ready      | 禁区                  |
|-----------|----------|--------|------------|----------------------|
| Arena     | c66c578  | 8/8 ✓  | false      | dry-run only, lab     |
| NightShift | ebea406 | 8/8 ✓  | EXECUTION_DISABLED | fail-closed |

## 未完成

- TeamSpace: 未开始（等待 Sol 批准 Arena + NightShift 修复）
- RunCenter: 未开始（依赖 TeamSpace 只读接头通过）
- 教材驾驶舱: 保留分支证据，未合 main

## 工作树状态

- 2origin-harness (feat/otel-observe): 仅受控 commit，无他人未提交改动
- ShadowOS-nightshift (feat/nightshift-protocol): 仅受控 commit，无他人未提交改动
- 无 push、无部署、无 U-King 修改

## 下一步

1. Sol 复审本轮修复
2. 批准后启动 TeamSpace 只读 snapshot/integrity 接头（见 handoff 文件完整路线）
3. TeamSpace 通过后启动 RunCenter 受管 OTLP artifact 宿主