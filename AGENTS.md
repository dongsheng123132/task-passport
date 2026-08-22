# task-passport / TaskPack — 开机文档

> 在这个目录开终端的第一件事：**打开护照，不要读聊天记录。**
>
> ```
> 护照 TP-3XZB-X84A  —— 本仓库的常驻状态
> ```
> MCP 已在 `.mcp.json` 里配好（`task_passport_open`）；没有 MCP 时用
> `node cli.js open TP-3XZB-X84A`。改状态走 `checkpoint` 并带 `expected_version`——
> 它会拒绝陈旧版本，而不是静默盖掉另一个终端。

## 这是什么

两个东西，一个仓库，**别混着叫**：

| | 是什么 | 形态 |
| --- | --- | --- |
| **Task Passport** | 常驻状态：有版本、有锁、留在 store 里，跨会话跨 harness | 活的原件 |
| **TaskPack** | 一次搬运：单文件、自包含、离线、在别人机器上打开 | 出门的包 |

`护照 --pack--> TaskPack --unpack/land--> 护照`。两种编码：`.taskpack`（BagIt + zip，正本）
与 `.taskpack.json`（扁平、零安装，**首次交接一律用这个**）。

规范正本在 `docs/taskpack-0.1.md`，站点是 https://taskpack.org（由 `site/build.mjs` 从 `docs/` 生成）。

## 最原创的那一条（别改掉它）

**机器级事实在「打包时」就封存为未证，并记下 `verified_on`。**
降级发生在打包端，不是落地端——安全属性必须长在文件里，不能长在接收方的实现上。
一个接手的 AI 拿到包，应该看见「这 10 条在原机器验过、在你这儿不成立」，而不是十个绿勾。

配套的一条：让事实失效的不只有「换了机器」，还有「够不着」。前者靠重验，后者靠开目录，
混为一谈会误导下一个接手的人。

## 常用命令

```bash
npm test          # 47 项，多数是反向用例
npm run check     # 语法检查全部入口文件
npm run pack:check
node cli.js doctor --store <dir>    # 会告警两个权威 store 同时在线
node site/build.mjs                 # 站点从 docs/ 重建，构建会拒绝发布破损声明
```

## 当前状态摘要（详细版在护照里，以护照为准）

- `main` 与 `origin/main` 同步，taskpack.org 三个端点 200。
- **npm 上 latest 已经是 0.3.0**（2026-08-16 以 `npm view task-passport version` 实查）。
  「文档说有、npm 上没有」这个缺口已经关闭。发布状态**只以 `npm view` 为准**，CI 绿灯不算数。
- **工作区有未提交改动，两块：**
  ① **回执合并 `land --into`**。它顺带暴露并修掉一个上游缺口：**`pack` 从前不把提出的 ask
  记进护照**，于是回执回来时无处可归、只能人工重录；现在 `pack` 会写回护照（幂等，
  内容没变不撞版本），输出里带 `asks_recorded`。
  ② **发件台账 `outbox.js` + `task-passport outbox`**。每次 pack 追加一行 JSONL 并存一份
  当时那份护照的**存根**（存的是封存后、真出门的那版）。回答「上周发给客户的那个包里到底有什么」。
  存根文件名带包的 sha256 前 8 位——**没有它，同一版同一秒打两个包会撞名互相覆盖**（冒烟时抓到的）。
  台账不是公证，能写 store 的人就能改它，README 里写明了这一条。
  测试 78/78，新增 `test/merge-receipt.test.mjs`(18) 与 `test/outbox.test.mjs`(12)，逐项变异验证过。
- **三机实测过（2026-08-16）**：两台 macOS + 一台 Windows Server，conformance 各 10/10、
  附件字节全一致、封存规则双向有效。**手填回执若加一条自己机器的事实并标 verified，会掉 C0**——
  落地宽容、判定严格，属预期行为，但要在给客户的说明里讲清楚。
- 本地分支 `fix/windows-bom-and-store-guardrails` 领先 main 8 个 commit 且**没有远端副本**。
  内容已以别的 commit 进了 main。**不要 push 它**：它的历史里 commit 了 `docs/STRATEGY.md`，
  而那份文件在 main 上是被 `.gitignore` 明文排除的内部判断。
- 工作区 3 个 `.tp-*.mjs` 是另一个终端留下的未跟踪探针，不属于任何提交。

## 约定

- **不给第三方 agent 关审批闸**（`--yolo` / `acceptEdits`）。这个项目处理的正是「别人发来的文件」——
  发送的是数据，安装的是权限，开口的是人。`.taskpack` 里不得出现指令性字段。
- **每个回归测试都要做变异验证**：去掉修复它必须挂。没在旧代码上失败过的回归测试是废的。
- **多终端并发是常态**：只提交自己改的文件，别 `git add -A`，别动别人的未跟踪文件。
  协作信号写进护照——护照本来就是为这个设计的。
- `docs/STRATEGY.md` 是内部判断（含杀死判据与收费边界），永不进公开仓库。
