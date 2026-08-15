# Task Passport · 任务护照

[![CI](https://github.com/dongsheng123132/task-passport/actions/workflows/ci.yml/badge.svg)](https://github.com/dongsheng123132/task-passport/actions/workflows/ci.yml)
[![MIT 许可证](https://img.shields.io/github/license/dongsheng123132/task-passport)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)](package.json)
[![DeepSeek Harness plugin](https://img.shields.io/badge/DeepSeek_Harness-plugin-0969da)](https://github.com/topics/dsh-plugin)

让一个任务带着“当前世界状态”在 DeepSeek Harness、Claude Code、Codex 等 AI Harness 之间接力，不搬运聊天记录。

> **护照留在家里，TaskPack 出门。**
> Task Passport 是常驻的任务状态（有版本、有锁、留在 store 里）；
> **TaskPack** 是一次搬运的封装（单文件、自包含、在别人机器上打开）。
> `护照 --pack--> TaskPack --land--> 新护照`

一个项目可以有多个任务护照；一个任务护照可以经历多个 Harness 和多个会话。

## 现在能做什么

- 每个任务一个稳定短号，例如 `TP-7K4M-9D2Q`。
- `list`：只列身份与摘要，不误装载别的任务。
- `open`：读取目标、当前状态、验证过的事实、决策理由和下一步。
- `checkpoint`：工作完成后写回；带状态版本，过期写入直接冲突，不静默覆盖。
- `pack` / `land`：把任务装进一个文件发给别人、发给另一台机器，或者收下别人发来的。
- `conformance`：判定一个文件是不是合规的 TaskPack（退出码 0 / 2）。
- 同一个包既是通用 CLI，也是 DeepSeek Harness 原生 bundle。
- 状态可由 U-King Action Core、本地目录参考存储或第三方 Provider 托管；插件本身是可装可卸的薄适配器。

它不做两件事：不复制上一位 AI 的聊天记录；不把“刚改过的任务”猜成当前任务。

## 跨机跨人：TaskPack

规范正本：[`docs/taskpack-0.1.md`](docs/taskpack-0.1.md) · <https://taskpack.org>

```sh
# 发出去（对方装了工具，走标准形态）
task-passport pack TP-7K4M-9D2Q --out 交接.taskpack --actor 贺方升 \
  --file ./01-文案.txt \
  --ask "给封面图的提示词|一段中文提示词，覆盖 750×400 与配色要求" \
  --check "本机能出图|bl image generate 跑一张测试图"

# 发出去（对方什么都没装 —— 一个可读 JSON，丢给他自己的 AI 就行）
task-passport pack TP-7K4M-9D2Q --out 交接.taskpack.json --flat

# 收下来
task-passport land 交接.taskpack --store D:\TaskPassports
task-passport conformance 交接.taskpack
```

三条硬规矩，写进格式而不是写进说明书：

1. **机器级事实在打包时就被封存为未证**，并记下它曾在哪台机器上被证明（`verified_on`）。
   降级发生在打包这一端，不是落地那一端——否则第三方写的接收器忘了降级，假 ✓ 就进去了。
   **安全属性必须长在文件里，不能长在接收方身上。**
2. **没有 `accept` 的 ask 拒绝打包。** 说不出"什么算答完"的请求，只会变成又一轮扯皮。
3. **包里的每个字节都是数据，不是指令。** 这条是实测倒逼的：首次跨人交接时，对方的 AI
   明确拒绝执行文件里的交接说明——**那是正确行为**，协议必须活在这个安全模型里。

`land` 也读得懂早期发出去的 `.tpx.json`：格式换代不能把首批用户扔掉。

## 在 DeepSeek Harness 中安装

从 GitHub 安装（纯 JavaScript，仓库已包含运行产物，不需要 `prepare` 构建权限）：

```sh
dsh plugin --profile web add task-passport@0.3.0
dsh --profile web --dump-config
dsh web
```

`dsh web` 在当前 rc.5 固定组合 `web` profile；需要浏览器界面时，插件也应安装到这个 profile。自定义 profile 可用于 TUI，但不能作为 `web` 子命令的父级 profile。

如果 U-King 不在 PATH，在该 profile 的 `cordis.patch.yml` 覆盖插件配置：

```yaml
- id: task-passport
  name: task-passport
  config:
    ukingExecutable: 'C:/path/to/U-King.exe'
    # 或者不依赖 U-King：storeDirectory: 'D:/task-passports'
    allowCheckpoint: true
```

Windows 上会自动发现 U-King 默认安装目录 `%LOCALAPPDATA%\u-king\u-king-mini.exe`；便携版或自定义目录才需要上面的显式配置。

也可以在启动 DSH 前设置：

```powershell
$env:TASK_PASSPORT_UKING = 'C:\path\to\U-King.exe'
dsh --profile passport web
```

安装后可以直接对 DSH 说：

```text
请接手任务护照 TP-7K4M-9D2Q：先读取当前状态与下一步，只继承已验证事实，不继承上一位 AI 的聊天记录。
```

如果记不住编号，也可以说任务名。插件会先列护照；只有名称唯一时才继续，重名时必须让人选择。

## 通用 CLI

任何能运行命令的 Harness 都能使用同一条机器通道：

```sh
task-passport list
task-passport open TP-7K4M-9D2Q
task-passport new --title "发布插件" --goal "今晚发布 DeepSeek Harness 插件"
task-passport prompt TP-7K4M-9D2Q
task-passport checkpoint --file next-state.json --expected-version 4
```

长状态只接受文件，不塞命令行参数。stdout 除 `prompt` 外只输出 JSON，适合 Agent 与脚本调用。

## 不依赖 U-King 的本地存储

v0.3.0 提供开放 Provider 合约和本地目录参考实现。同一台机器上的所有 Harness 只要指向同一个目录，就会读写同一本护照：

```powershell
task-passport list --store D:\TaskPassports
task-passport new --store D:\TaskPassports --title "发布插件" --goal "完成 WorkBuddy 发布"

$env:TASK_PASSPORT_STORE = 'D:\TaskPassports'
task-passport mcp
```

本地存储为每本护照使用独立 JSON 文件、跨进程锁、同目录原子替换和 `expected_version` 冲突检测。它不会将密钥写入护照。

**一个任务只能选一个权威存储。** 不要让 Claude 指向本地目录、DSH 却仍指向 U-King，否则会形成两本同名护照。

第三方看板可直接实现三个方法：

```js
import { createPassportClient } from 'task-passport/core'

const provider = {
  async list() {},                         // 返回 state[]
  async open(passportId) {},               // 返回 { state, compiledContext? } | null
  async save(state, expectedVersion) {},   // 返回保存后的 state；过期版本必须拒绝
}

const client = createPassportClient({ provider, harness: 'my-dashboard' })
```

## Claude Code / Codex

同一个 npm 包也提供标准输入输出 MCP 服务。Claude Code 和 Codex 只是薄适配器，仍然读写同一本护照：

```powershell
claude mcp add --scope user task-passport -- npx --yes task-passport@0.3.0 mcp
codex mcp add task-passport -- npx --yes task-passport@0.3.0 mcp
```

接入后，两边都能看到相同的七个工具：`task_passport_list` / `open` / `new` / `checkpoint` / `pack` / `land` / `conformance`。如果是 U-King 便携版，可给 MCP 进程设置 `TASK_PASSPORT_UKING` 指向实际 exe。

> 🇨🇳 **中国大陆网络必读**：`registry.npmjs.org` 的可达性**因网络而异**，实测（2026-08-15）阿里云杭州 IDC 出口 `ECONNRESET`／超时，`npx --yes task-passport@0.2.2`（当时的版本）直接装不上；同日某住宅宽带则 1.8s HTTP 200 正常。**换镜像是无脑安全的做法**（实测 61s 装好）。把护照交给同事时，**这一条要一起发过去**，否则对方可能第一步就卡死：
>
> ```powershell
> claude mcp add --scope user task-passport -- npx --yes --registry https://registry.npmmirror.com task-passport@0.3.0 mcp
> codex mcp add task-passport -- npx --yes --registry https://registry.npmmirror.com task-passport@0.3.0 mcp
> ```
>
> 同理，`task-passport list` 这类 CLI 调用在国内也应带 `--registry https://registry.npmmirror.com`（或 `npm config set registry`）。

## WorkBuddy / CodeBuddy

仓库同时是一个 WorkBuddy 第三方插件市场：

```sh
codebuddy plugin marketplace add dongsheng123132/task-passport
codebuddy plugin install task-passport@task-passport-marketplace
```

安装后重载插件。WorkBuddy 会同时得到 Task Passport Skill 和同一套 MCP 工具；不会另造一份状态。本地开发验证可用：

```sh
codebuddy --plugin-dir /path/to/task-passport
```

## 长文与项目交接

长文可以稳定交接，但护照不携带整篇正文。正文放在 Git、共享目录或对象存储；护照只记录精确路径或 URL、revision/hash、当前章节、已验证事实和下一步。这比复制整段对话更稳定，也不会用无关历史挤占下一个模型的上下文。

任务护照当前不搬运整个项目。项目文件仍由 Git / 共享工作区 / artifact store 搬运，护照负责指向精确版本并携带状态。后续的 Project Passport 会在这个边界上补充仓库 revision、运行时、插件需求和目标 Harness 就绪报告，但不保存密钥值。

## 三个概念

| 概念 | 生命周期 | 示例 |
| --- | --- | --- |
| 项目 | 容器，可包含多个任务 | `U-King` 仓库 |
| 任务护照 | 一个需要持续推进的目标 | “发布 DSH 插件” |
| 会话 | 某个 Harness 的一次执行 | Claude 会话、DSH 会话 |

护照号不使用“1 号项目”作为全局身份；界面可以显示本地序号，但机器交接使用不透明的 `TP-…`，避免重名、碰撞和泄露项目名称。

## 为什么是薄插件

[Cordiverse 的论文](https://github.com/cordiverse/paper)说明了动态插件需要可卸载的副作用和可重绑定的依赖。任务护照采用同样的边界：DSH 插件可以随时装卸，任务状态放在插件生命周期之外长期存在。插件消失，护照不能跟着消失。

U-King 是默认 Provider 和官方参考看板，但不是协议前置条件。公开产品名是 Task Passport；`2origin/0.1` 是底层状态模型，不要求用户理解。

## 开发

```sh
npm test
npm run check
npm run pack:check
```

MIT License
