# task-passport / TaskPack — 开机文档

> 在这个目录开终端的第一件事：**打开护照，不要读聊天记录。**
>
> ```
> 护照 TP-3XZB-X84A  —— 本仓库的常驻状态（最后记录停在 v0.3.1，见下）
> ```
> MCP 已在 `.mcp.json` 里配好（`task_passport_open`）；没有 MCP 时用
> `node cli.js open TP-3XZB-X84A`。改状态走 `checkpoint` 并带 `expected_version`——
> 它会拒绝陈旧版本，而不是静默盖掉另一个终端。
>
> ⚠️ **这本护照的真身在 Windows 那台（pc-3116）的 U-King store**：
> `C:\Users\ZhuanZ\.uking\origin\TP-3XZB-X84A.json`。Mac 的 store 里没有它——
> `node cli.js list` 看不到时别以为丢了。本机独立干活用 `--store <目录>`
> （或 `TASK_PASSPORT_STORE`），以本文件 + `git log` 为准。

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
npm test          # 90 项，多数是反向用例（含发布产物与版本一致性守卫）
npm run check     # 语法检查全部入口文件
npm run pack:check
node cli.js doctor --store <dir>    # 会告警两个权威 store 同时在线
node site/build.mjs                 # 站点从 docs/ 重建，构建会拒绝发布破损声明
```

## 当前状态摘要（详细版在护照里，以护照为准）

- `main` 与 `origin/main` 同步；CI 三平台（ubuntu / windows / macOS）跑 Node 22 全绿；
  taskpack.org 三个端点 200。GitHub Releases 由 `release.yml` 在发 npm 后自动创建。
- **npm 上 latest = 0.3.2**（2026-11-03 发布，带 SLSA provenance）。
  历史坑：**0.3.1 的 npm 包缺 `outbox.js`**，而 `cli.js` / `mcp.js` 第一行就 import 它——
  CLI 与 MCP 启动即 `ERR_MODULE_NOT_FOUND`。0.3.2 已修（`package.json` files 补上、
  发布前 tarball 守卫点名 8 个入口文件、回归测试兜住），0.3.0 与 0.3.1 的 GitHub Release
  是补建的，0.3.1 的 notes 里写明了这个缺陷。**发布状态只以 `npm view` 为准**，CI 绿灯不算数。
- 测试 **90/90**。本轮三条回归测试都做过变异验证（去掉修复必红）：
  `test/publish.test.mjs`（tarball 必须覆盖入口 import 的本地模块；README 安装 pin 必须等于
  package.json）、`test/core.test.mjs`（U-King 候选改为可注入，macOS 装了 U-King 也不再误判）。
- 工作区杂物在本机 `.git/info/exclude` 里隔离（**不随仓库分发**）：`site-web/`
  （taskpassport.com 产品站，构建通过 4 页，归属待定）、`handoffs/outbox.jsonl` 与
  `handoffs/outbox/`、`handoffs/TP-GOAI-FINAL-0917.json`。`.tp-*.mjs` 三个探针仍按 .gitignore 忽略。
- **护照本身停在 v0.3.1 已发布（2026-08-26 的记录）**，还没记 0.3.2；下次开护照时先补这一笔。
- 已知待升级（不阻塞发版）：Actions 仍 v4（runner 已警告 Node 20 弃用；checkout/setup-node
  最新 v7，pages 两个 action 最新 v5）；`engines` 仍 >=20，计划随 0.3.3 抬到 22；Dependabot 关闭。

## 约定

- **不给第三方 agent 关审批闸**（`--yolo` / `acceptEdits`）。这个项目处理的正是「别人发来的文件」——
  发送的是数据，安装的是权限，开口的是人。`.taskpack` 里不得出现指令性字段。
- **每个回归测试都要做变异验证**：去掉修复它必须挂。没在旧代码上失败过的回归测试是废的。
- **多终端并发是常态**：只提交自己改的文件，别 `git add -A`，别动别人的未跟踪文件。
  协作信号写进护照——护照本来就是为这个设计的。
- `docs/STRATEGY.md` 是内部判断（含杀死判据与收费边界），永不进公开仓库。
