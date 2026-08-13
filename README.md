# Task Passport · 任务护照

让一个任务带着“当前世界状态”在 DeepSeek Harness、Claude Code、Codex 等 AI Harness 之间接力，不搬运聊天记录。

> 一个项目可以有多个任务护照；一个任务护照可以经历多个 Harness 和多个会话。

## 现在能做什么

- 每个任务一个稳定短号，例如 `TP-7K4M-9D2Q`。
- `list`：只列身份与摘要，不误装载别的任务。
- `open`：读取目标、当前状态、验证过的事实、决策理由和下一步。
- `checkpoint`：工作完成后写回；带状态版本，过期写入直接冲突，不静默覆盖。
- 同一个包既是通用 CLI，也是 DeepSeek Harness 原生 bundle。
- 状态与并发门禁复用 U-King Action Core；插件本身是可装可卸的薄适配器。

它不做两件事：不复制上一位 AI 的聊天记录；不把“刚改过的任务”猜成当前任务。

## 在 DeepSeek Harness 中安装

从 GitHub 安装（纯 JavaScript，仓库已包含运行产物，不需要 `prepare` 构建权限）：

```sh
dsh plugin --profile passport add github:dongsheng123132/task-passport
dsh --profile passport --dump-config
dsh --profile passport web
```

如果 U-King 不在 PATH，在该 profile 的 `cordis.patch.yml` 覆盖插件配置：

```yaml
- id: task-passport
  name: task-passport
  config:
    ukingExecutable: 'C:/path/to/U-King.exe'
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

## 三个概念

| 概念 | 生命周期 | 示例 |
| --- | --- | --- |
| 项目 | 容器，可包含多个任务 | `U-King` 仓库 |
| 任务护照 | 一个需要持续推进的目标 | “发布 DSH 插件” |
| 会话 | 某个 Harness 的一次执行 | Claude 会话、DSH 会话 |

护照号不使用“1 号项目”作为全局身份；界面可以显示本地序号，但机器交接使用不透明的 `TP-…`，避免重名、碰撞和泄露项目名称。

## 为什么是薄插件

[Cordiverse 的论文](https://github.com/cordiverse/paper)说明了动态插件需要可卸载的副作用和可重绑定的依赖。任务护照采用同样的边界：DSH 插件可以随时装卸，任务状态放在插件生命周期之外长期存在。插件消失，护照不能跟着消失。

Task Passport 当前把 U-King 的 `2origin/0.1` 对象状态作为权威存储。公开产品名是 Task Passport；2Origin 是底层状态模型，不要求用户理解。

## 开发

```sh
npm test
npm run check
npm run pack:check
```

MIT License
