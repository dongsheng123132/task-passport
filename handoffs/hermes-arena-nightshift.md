# Hermes 长程任务：U-King 测试能力迁入本源 AI 计算机

## 目标

持续执行已批准的迁移路线：让实验能力先在本源 AI 计算机拥有真实、可复跑、受控的宿主，再由 U-King 通过固定契约接入成熟版本。每条线必须完成验收、停在 Sol 审核点，才可进入下一阶段。不得改变产品边界或开启任何真实执行。

## 任务护照

任务护照为 `TP-4JMK-EKR6`。先运行 `node cli.js open TP-4JMK-EKR6`（工作目录 `D:\uking编程\task-passport`）读取目标、当前状态与 next step。护照只传递状态，不替代下列验收标准。每完成一个阶段再用其当前 `state_version` 做 checkpoint；不得猜测版本号。

## 范围与唯一真相

1. Arena：`D:\uking编程\2origin-harness`，当前干净验证链顶为 `b5d6df6`。
2. NightShift：`D:\uking编程\ShadowOS-nightshift`，当前隔离 worktree 链顶为 `26e3591`。
3. 两个目录都可能存在其他人的未提交改动。先 `git status`；只提交自己改的文件，绝不 `git add -A`、reset、clean、覆盖或删除他人内容。

## 全局路线与顺序

1. 教材驾驶舱：已具备 U-King BookOrigin 接头与独立导航隐藏提交；主工作树仍有用户未提交改动，**不得**自行合入 `main`、推送或发布。仅在需要时复验整合分支证据。
2. Arena：先完成本源 evidence-complete lab，再讨论独立真实执行器；U-King 不跑客户机 benchmark。
3. NightShift：先冻结 fail-closed 协议和本源 dry-run，后续才讨论受控执行器；U-King journal/稳定调度保留。
4. TeamSpace：先将 U-King localStorage 演示替换为本源 AgentTeams 的只读 snapshot/integrity 接头；随后才讨论 CAS 写动作。
5. RunCenter：先建设受管、版本化、安全的本源 OTLP artifact 宿主和导入契约；后续才讨论 collector。 

不得跳过顺序，也不得把“导航隐藏”称为“能力已迁出”。

## Arena：当前必须修复

Sol 已确认安全 scaffold 可保留，但 evidence-complete lab 尚未通过。请：

- 让公开的 result JSON Schema 与运行时 `validateResult` 同形、同样严格；实际调用 schema 校验。
- 对 `resolved_plan` 等深层对象拒绝 unknown / secret 字段；补会在旧实现失败的反向测试。
- 在一个干净 checkout/worktree 运行完整测试，记录 commit、命令与结果。

保持：`lab / ready:false`；没有真实 execute、网络、模型客户端、账本/缓存/输出写入。

## NightShift：当前必须修复

Sol 已确认 execute 永远关闭，但协议尚未冻结。请：

- `execute-request` schema 若 required `plan`，必须在 `properties` 中定义对应形状；合法请求应可通过 schema 后再被 `EXECUTION_DISABLED` 拒绝。
- 无效 `expires_at` 必须拒绝，不能通过 NaN 绕过。
- unsafe handoff 拒绝响应不得回显原始 `evidence_refs`。
- `intent_ref` 仅允许保守不透明引用；拒绝 URL、命令式/路径式输入。
- 补会在旧实现失败的反向测试。

保持：没有 CLI、shell/命令执行、网络、模型调用、状态写入；`execute` 永远 `EXECUTION_DISABLED`。

## TeamSpace：Arena 与 NightShift 获 Sol 批准后才开始

- 真相源：本源 `ShadowOS/agentteams/coordination.mjs` 与 `worktree.mjs`；U-King 旧页只是 localStorage 演示，不能迁数据或双写。
- 首片只允许 readonly `snapshot` / `integrity` 契约与脱敏 fixture；不得由 GUI 直接读本源 board 文件。
- 后续写动作必须分开 claim / mark_done / verify_done，且带不透明任务 ID、`expected_state_version`、幂等键和独立复核证据；禁止自证。
- 完成前不得隐藏 U-King TeamSpace。

## RunCenter：TeamSpace 通过只读接头后才开始

- 本源先提供受管、Git 跟踪的 OTLP artifact 宿主；禁止读取开发机静态目录或未跟踪 viewer。
- 首片只允许带 hash、大小/span 限制、严格 OTLP schema 与脱敏的 readonly import/inspect。
- synthetic TTFT 与成本估算必须显式标注，不能伪装真实指标；禁止开放公网 collector。
- 完成前不得隐藏 U-King RunCenter。

## 禁区

- 不改 U-King、不改其主工作树或导航。
- 不启动 Arena 真实模型执行、不开网络客户端、不花费 Token。
- 不启动 NightShift 实际执行器、不运行客户目录命令。
- 不 push、部署、发布、删文件或修改凭据。
- 不以改 baseline、放宽测试或抹掉错误信息来让检查变绿。

## 每条线通用验收与交接

1. Arena：完整测试在干净 checkout 中通过；新增反向用例证明深层 secret/unknown 字段与 result schema 漂移会被拒。
2. NightShift：定向 Node 测试通过；合法 schema 请求到达 fail-closed 的 `EXECUTION_DISABLED`，四类非法输入稳定拒绝且无敏感回显。
3. TeamSpace 与 RunCenter 按各自前置完成，且每项有 machine-readable schema、正反 fixture、没有开发机路径/客户数据泄漏。
4. 每个仓库独立小步 commit；工作树只剩事先存在的他人改动或完全干净。
5. 每一阶段都更新任务护照 checkpoint，带最新 `expected_version`；记录真实 commit、命令、结果和 blockers。
6. 输出报告到 `D:\uking编程\task-passport\handoffs\hermes-origin-migration-report.md`：每条线的阶段、commit、测试命令/真实结果、未完成项、是否仍为 `ready:false`。
7. 不宣称已迁回 U-King；最终裁决留给 Sol。每条可进入 U-King 的线必须等待主会话明确批准，Hermes 不能自行合入主线、隐藏导航、push 或发布。

## 本轮执行边界

本轮只执行 Arena 和 NightShift 的“当前必须修复”段，完成后 checkpoint 并停止等待 Sol 复审。TeamSpace、RunCenter 是后续阶段说明，绝不可在本轮提前创建代码、目录或接头；教材驾驶舱也只保留证据，不处理合入。
