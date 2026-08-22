# Foxit eSign 集成（Hackathon）— Your Agent Shouldn't Sign That

参加 DevNetwork [API+Cloud+AI] Hackathon 2026 / Foxit 赛题的可运行示例：
**端到端的 agent 签署工作流** —— 可逆的活 agent 自己干，不可逆的送签必须有人批，
而「人为什么说 yes」这件事本身，成为有版本、可携带、防篡改的一等对象。

## 赛题是什么，我们在回应什么

Foxit 赛题的设定：他们开源了一个 MCP server，包了 PDF Services API 的 40 个工具
（生成 / 转换 / 合并 / 压缩 / OCR / 提取）——**全部是可逆操作**。**签名故意不在
工具集里**：要送签，agent 必须拿自己的凭据直接调 eSign API，且必须有真人签。

我们同意这个方向，但认为它只做了一半：

> 把签名从工具目录里拿掉，挡住了 agent 去签——但它**不产生「人为什么说 yes」的记录**。
> 缺的那一半是：让人的授权本身成为一个有版本、可携带、防篡改的一等对象，
> 并且在 agent 崩溃 / 换模型 / 换机器之后依然成立。

挡住 agent 是**行为控制**；记录「谁、在什么时候、批准了哪一版」是**问责材料**。
出事时被追问的正是后者。所以这个 demo 演的是：

**可逆的活 agent 自己干；到了不可逆那一步，它停下来、提出 ask、打包出门、
等人的回执回来、核对回执批的是不是同一份文档，然后才调 eSign。**

而 TaskPassport 在这里的价值不是「又一种审批流」，是这三条机器边界上的性质：

1. **版本**：每次写回护照都带 `expected_version`，冲突报错不覆盖——人和 agent 的
   每一步决策都有版本可查。
2. **可携带**：ask 和回执是 `.taskpack.json` 文件，不是聊天记录。agent 崩溃了、
   换了模型、换了机器，回执 land 回同一本护照，答案自动合并回原问题。
3. **防篡改的绑定**：回执带「人看到的那份 PDF 的 sha256」。签之前 agent 现算本地
   文件的 sha256 比对——**批的是哪一版，签的就是哪一版**，中间被改一个字节都拒绝。

## 架构

```text
自然语言任务
    │  plan（node cli.js new → 护照 TP-XXXX）
    ▼
任务护照（有版本、有锁、留在 agent store）
    │  draft：渲染模板 → createPdfFromHtml → 落盘 contract.pdf
    │        → extractText 自检 → checkpoint（本机已验证的事实）
    ▼
Foxit 可逆工具（PDF Services：生成/提取/压缩——错了可以重来，不用人批）
    │
    │  到签名边界：我不能签，需要人的批准
    ▼
╔══════════ ask 边界（护照里记下问题，pack 出门）══════════╗
    │                                                      │
    │  for-review.taskpack.json（含合同 PDF + 封存的事实）   │
    ▼                                                      ▼
人审（review.mjs show：哪些在你这台机器上未证？sha256？它在问什么？）
    │  approve（或 --reject）→ land 进 human store → 写决定
    ▼
回执 receipt.taskpack.json（approve/reject + 人看到的那份 PDF 的 sha256）
    │
    │  cli.js land --into 原护照（答案合并回原 ask，不新开护照）
    ▼
核对哈希：回执 sha256 == 本地现算 sha256？
    │  不一致 → 退出码 2，拒绝送签
    ▼
eSign（getAccessToken → createFolder → sendDraftFolder → viewActivityHistory）
    │
    ▼
folderId + 送签时间 + 审计轨迹 checkpoint 回护照 → 责任链摘要
```

## 40 个可逆工具 vs 1 个不可逆动作：边界为什么画在这里

| | 工具 | 反悔成本 | 需要人批准吗 |
| --- | --- | --- | --- |
| PDF 生成 | `createPdfFromHtml` | 重新生成一次，免费 | 否 |
| 文本提取 | `extractText` | 重跑一次，免费 | 否 |
| 压缩 | `compress` | 换参数重压，免费 | 否 |
| **送签** | `createFolder` + `sendDraftFolder` | **合同已经发给客户了** | **是** |

边界不按「是不是 Foxit 工具」划，按**不可逆性**划：生成错了可以重来，签错了
是要付钱的承诺。这正是出题人留的论证空间——「边界该划在哪」的答案不是
「agent 永远不能碰 eSign」，而是「agent 可以走到门口，但门只对
**带着人批准的回执、且回执绑定的是同一份文档**的 agent 开」。

顺带一提：把签名移出工具目录解决的是「agent 不该自作主张」，它没有解决
「agent 怎么证明自己没自作主张」。我们的闸门同时回答两个问题——agent 手里
没有 eSign 快捷方式（凭据在服务端、调用被 ask 闸门挡着），**而且**它每一次
送签都带着一条可核查的批准记录。

## 免凭据演示（一条命令，全 mock）

```bash
bash examples/foxit/demo.sh            # 完整流程
bash examples/foxit/demo.sh --no-approval   # 反例①：没人批准就去签 → 退出码 3
bash examples/foxit/demo.sh --tamper        # 反例②：批准后文档被改 → 退出码 2
```

mock 模式不碰网络：PDF 是确定性的（同样输入 → 同样 sha256），eSign 返回稳定的
`MOCK-FOLDER-<sha256 前 8 位>`。demo 用**两个独立 store**（`.demo-foxit/agent-store`
和 `human-store`）模拟两台机器——这是本仓库最原创的一条必须被看见：

> agent 在自己机器上验过的事实（「合同含费用条款，已自检」），pack 出门时被
> **封存为未证**，review show 到人这边打印的就是「⚠️ 未证：曾在 agent 机器上
> 验证过，在你这台机器上先重验」。十个绿勾不会跨机器旅行。

## 文件

- `foxit-pdf.mjs` —— PDF Services 客户端：`createPdfFromHtml` / `extractText` /
  `compress`，每个都有 `--mock` 确定性路径；真实模式 2026-08-22 已按沙箱凭据 +
  OpenAPI 规范（`/pdf-services/v3/api-docs`）实测校准：upload → 操作 → 轮询任务 → download。
- `foxit-esign.mjs` —— eSign 客户端：`createFolder` / `sendDraftFolder` /
  `viewActivityHistory`（草稿态审计报错已容忍）。2026-08-22 已实测校准：统一平台
  网关（na1.fusion.foxit.com/esign/api/v1）+ client_id/client_secret 双 header 鉴权，
  没有 OAuth token；createfolder 需带 signature 域才能送签。
- `agent.mjs` —— 工作流主程序：`plan`（开护照）/ `draft`（可逆的活 + 停在签名边界）/
  `sign`（四道闸门，判分关键）。
- `review.mjs` —— 人这一侧：`show`（看清包里有什么、哪些未证、它在问什么）/
  `approve`（批准或拒绝，打回执）。薄壳，全部走 `cli.js`。
- `demo.sh` —— 全 mock 端到端 + 两个必须 FAIL 的反向用例。
- `templates/consulting-agreement.html` —— 带 `{{client_name}}` 等占位符的合同模板。

## 手动走一遍（想看清每一步时）

```bash
# 1. agent 开护照
node examples/foxit/agent.mjs plan --task "为 Acme Co. 起草咨询合同并送签" \
  --store .demo-foxit/agent-store

# 2. draft：渲染 → PDF → 自检 → 停在签名边界，打包出门
node examples/foxit/agent.mjs draft --passport <TP-ID> --store .demo-foxit/agent-store \
  --out .demo-foxit/out --mock

# 3. 人审：重点看「⚠️ 未证」那几行、sha256、ask 原文
node examples/foxit/review.mjs show .demo-foxit/out/for-review.taskpack.json

# 4. 人批准（--reject 则拒绝），回执带上他看到的那份 PDF 的 sha256
node examples/foxit/review.mjs approve .demo-foxit/out/for-review.taskpack.json \
  --into-store .demo-foxit/human-store --actor "张老师" --out .demo-foxit/out

# 5. 回执 land 回 agent 的护照（答案合并回原 ask，不新开护照）
node cli.js land .demo-foxit/out/receipt.taskpack.json --into <TP-ID> --store .demo-foxit/agent-store

# 6. sign：四道闸门全过才调 eSign，打印责任链
node examples/foxit/agent.mjs sign --passport <TP-ID> --store .demo-foxit/agent-store \
  --out .demo-foxit/out --mock --signer-email jane.doe@acme.example --signer-name "Jane Doe"
```

sign 的退出码就是闸门的判分口径：**0** 全过并送签；**2** 哈希不一致（批准的和
手上不是同一版）；**3** 没人批准 / 不是 approve。反例脚本验证的就是 2 和 3。

上面的命令全带 `--mock`，免凭据可跑。走真实 API 就去掉 `--mock`：export 好
`FOXIT_CLOUD_API_CLIENT_ID` / `FOXIT_CLOUD_API_CLIENT_SECRET` 即可——PDF Services
这侧 2026-08-22 已实测跑通（真实生成的 PDF + 真实提取的文本）。eSign 的
`FOXIT_ESIGN_*` 未到手前，`sign` 会在凭据检查那里报清楚错误地停下：那是「缺
凭据」，不是 ask 闸门，别拿它冒充「人没批准」的反例。

## 真实凭据配置（两套，别混）

| | 环境变量 | 干什么 |
| --- | --- | --- |
| PDF Services | `FOXIT_CLOUD_API_HOST`（默认 `https://na1.fusion.foxit.com/pdf-services`）<br>`FOXIT_CLOUD_API_CLIENT_ID` / `FOXIT_CLOUD_API_CLIENT_SECRET` | 生成/提取/压缩 |
| eSign | `FOXIT_ESIGN_HOST`（默认 `https://na1.foxitesign.foxit.com`）<br>`FOXIT_ESIGN_CLIENT_ID` / `FOXIT_ESIGN_CLIENT_SECRET` | 送签（和 PDF Services **不是同一套**凭据） |

去掉 `--mock` 即走真实 API。**PDF Services 的鉴权与端点已用沙箱凭据实测校准
（2026-08-22）**，与赛题文档的旧表述不同，以实测为准：

- 鉴权：请求头 `client_id` / `client_secret` 两个字段（不是 Basic、不是 Bearer，
  也不需要 x-api-key——OpenAPI spec 里的 securityScheme 与真实网关不符）。
- 流程：`POST /api/documents/upload`（multipart，字段 `file`）→ documentId →
  `POST /api/documents/<操作>`（生成 `/create/pdf-from-html`、提取
  `/convert/pdf-to-text`、压缩 `/modify/pdf-compress`）→ 202 {taskId} →
  `GET /api/tasks/{taskId}` 轮询到 COMPLETED → 结果 documentId →
  `GET /api/documents/{id}/download`。
- 完整 OpenAPI 规范在网关的 `/pdf-services/v3/api-docs`，已存进
  `.devpost-foxit/foxit-openapi.json`（.gitignore 内，不进公开仓库）。

**eSign 也已实测校准（2026-08-22，控制台自助激活，Account #2907377）**，与赛题文档
的旧表述（na1.foxitesign.foxit.com + OAuth token）不同，以实测为准：
- 端点和 PDF Services 同一个统一网关 `na1.fusion.foxit.com`，前缀 `/esign/api/v1`
  （`createfolder` / `sendDraftFolder` / `viewActivityHistory?folderId=`），
  同一套 client_id/client_secret 双 header 鉴权，**没有 access_token 流程**。
- 建封套时**必须给签署人分配 signature 域**（fields 数组），否则送签报错。
- 草稿态审计返回 "logs of a non-shared folder can not be viewed"（已容忍）。
- 送签后收件人会收到来自 notifications@foxitsign.com 的签署邀请（真实 demo 已验证）。
凭据用 `FOXIT_ESIGN_CLIENT_ID/SECRET`，未设时回退到 PDF Services 同一套
`FOXIT_CLOUD_API_CLIENT_ID/SECRET`（统一平台实测可用）。

凭据只从环境变量读，不进代码、不进输出、不进命令历史。

## 这个 demo 不证明什么（必读）

- **回执不是公证。** 能写 store 的人就能改它——这和「能改数据库的人就能改审计
  日志」是同一个边界，TaskPack 不假装自己有防伪硬件。
- **它证明的是「批准的是哪一版、谁批的」，不是「这个人真的存在过」。**
  `answered_by` 是回执自报的署名，我们没有做身份认证（那是 IETF Agent Passport
  System / APS 的活，见规范 §7）。
- **它不证明流程能防住恶意的 agent。** 一个被完全攻破的 agent 可以直接改护照
  文件或伪造回执。这个设计的价值是把「没做」和「做了但说不清」变成「做了、
  且每一步都有版本可查」——让意外可发现，让抵赖变困难，不是让伪造不可能。
- **本示例的 eSign 送签跑的是沙箱真实 API**（2026-08-22 完整真链路：真 PDF →
  ask → 人批 → 哈希核对 → 送签 folderId=35504526，签署邀请已送达收件人邮箱）。
  它证明「批准的是哪一版、谁批的」在真实 eSign 调用前成立；它不证明收件人真的
  会签——签署由收件人自己完成，demo 停在「已送出邀请」。

## 和 gemini 示例的关系

`examples/gemini/` 演示「任务跨 harness 交接」（Agent A → Gemini ADK → 回传）；
本示例演示「任务在 agent 和**人**之间交接，且卡在不可逆动作的审批闸门上」。
两者共用同一套 TaskPassport 原语：`ask`（带 `accept` 的请求）、`receipt`
（回答回家，`land --into` 合并回原护照）、机器级事实打包时封存。
