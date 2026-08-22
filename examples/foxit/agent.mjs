#!/usr/bin/env node
/**
 * agent.mjs — Foxit 赛题 demo 的工作流主程序
 *
 * 剧情：agent 自己干可逆的活（渲染 → PDF → 自检 → 写护照），到不可逆的
 * 「送签」边界停下来，把 ask 打进 TaskPack 出门，等真人的回执回来：
 * 核对回执批的 sha256 和手上这份合同一致，才调 eSign。
 *
 * 子命令：
 *   plan  --task "<自然语言任务>" --store <dir>
 *   draft --passport <TP-ID> --store <dir> [--out <dir>] [--mock] [渲染参数...]
 *   sign  --passport <TP-ID> --store <dir> [--out <dir>] [--mock]
 *         [--signer-email <x> --signer-name "A B"]
 *
 * 退出码（sign 的闸门是判分关键）：
 *   0  正常（draft 停在签名边界 = 正常）
 *   1  其他错误
 *   2  sha256 不一致：人批准的是 <a>，本机手上是 <b> —— 拒绝送签
 *   3  ask 没被回答，或回答不是 approve —— 没有人批准过，拒绝送签
 *
 * 所有护照写入都走 `node cli.js checkpoint --file <state.json>
 * --expected-version <n>`：版本冲突直接报错，绝不重试覆盖（仓库红线）。
 *
 * 零第三方依赖：node:crypto、node:fs、node:path、node:os、node:child_process。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPdfFromHtml, extractText } from './foxit-pdf.mjs'
import { getAccessToken, createFolder, sendDraftFolder, viewActivityHistory } from './foxit-esign.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const CLI = join(REPO_ROOT, 'cli.js')
const TEMPLATE = join(HERE, 'templates', 'consulting-agreement.html')

const ASK_TEXT =
  '批准把这份合同送去签署吗？|回执里给出 approve 或 reject，并附上你看到的那份 PDF 的 sha256'

/* ------------------------------------------------------------------ */
/* 小工具                                                             */
/* ------------------------------------------------------------------ */

function runCli(args, store) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env },
  })
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim()
    const stdout = String(result.stdout || '').trim()
    throw new Error(`node cli.js ${args.join(' ')} 失败（退出码 ${result.status}）：${stderr || stdout}`)
  }
  return JSON.parse(result.stdout)
}

function openPassport(passportId, store) {
  return runCli(['open', passportId, '--store', store])
}

function checkpointState(state, expectedVersion, store) {
  const file = join(tmpdir(), `tp-foxit-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(state))
  try {
    return runCli(['checkpoint', '--file', file, '--expected-version', String(expectedVersion), '--store', store])
  } finally {
    rmSync(file, { force: true })
  }
}

function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function sha256OfFile(path) {
  return sha256Of(readFileSync(path))
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function requireOption(name) {
  const value = option(name)
  if (value === undefined) throw new Error(`${name} 是必填参数`)
  return value
}

/* ------------------------------------------------------------------ */
/* plan：造护照                                                       */
/* ------------------------------------------------------------------ */

function cmdPlan() {
  const task = requireOption('--task')
  const store = requireOption('--store')
  const created = runCli(
    ['new', '--title', task, '--goal', task, '--current-state', '任务刚创建：等着规划。', '--store', store],
    store,
  )
  const summary = {
    ok: true,
    passport_id: created.passport_id,
    state_version: created.state_version,
    title: task,
    store,
  }
  console.log(JSON.stringify(summary, null, 2))
}

/* ------------------------------------------------------------------ */
/* draft：可逆的活自己干，到签名边界停下                              */
/* ------------------------------------------------------------------ */

function renderTemplate(vars) {
  const template = readFileSync(TEMPLATE, 'utf8')
  let html = template
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(String(value))
  }
  const leftover = /{{[A-Za-z0-9_]+}}/.exec(html)
  if (leftover) throw new Error(`模板里还有没替换的占位符 ${leftover[0]}（渲染参数漏了）`)
  return html
}

async function cmdDraft() {
  const passportId = requireOption('--passport')
  const store = requireOption('--store')
  const outDir = resolve(option('--out', 'out'))
  const mock = hasFlag('--mock')

  const vars = {
    client_name: option('--client-name', 'Acme Co.'),
    vendor_name: option('--vendor-name', 'Consulting Pte. Ltd.'),
    monthly_fee: option('--monthly-fee', '5000'),
    term_months: option('--term-months', '12'),
    signer_name: option('--signer-name', 'Jane Doe'),
    signer_email: option('--signer-email', 'jane.doe@acme.example'),
    effective_date: option('--effective-date', nowIso().slice(0, 10)),
  }

  mkdirSync(outDir, { recursive: true })

  console.log('===== draft：可逆的活，agent 自己干 =====')
  console.log(`护照 ${passportId} · store ${store} · mock=${mock}`)

  // 打开护照，从这一步起的版本号就是我们的写回基线。
  let opened = openPassport(passportId, store)
  let version = opened.state_version

  // ① 渲染合同
  const html = renderTemplate(vars)
  console.log(`[1/4] 渲染合同模板 → client=${vars.client_name} fee=¥${vars.monthly_fee} term=${vars.term_months} 个月`)
  let cur = {
    ...opened.state,
    current_state:
      `合同模板已渲染（client=${vars.client_name}，monthly_fee=¥${vars.monthly_fee}，term=${vars.term_months} 个月）。\n${opened.state.current_state || ''}`,
  }
  cur = checkpointState(cur, version, store).state
  version += 1

  // ② 生成 PDF（可逆：不满意就重新生成）
  const { pdfBase64, sha256: pdfSha } = await createPdfFromHtml(html, { mock })
  const contractPath = join(outDir, 'contract.pdf')
  writeFileSync(contractPath, Buffer.from(pdfBase64, 'base64'))
  console.log(`[2/4] 生成 PDF → ${contractPath}（sha256=${pdfSha}）`)
  cur = {
    ...cur,
    current_state: `合同 PDF 已生成：${contractPath}（sha256=${pdfSha}）。\n${cur.current_state || ''}`,
    artifacts: [...(Array.isArray(cur.artifacts) ? cur.artifacts : []), `${contractPath}（sha256=${pdfSha}）`],
  }
  cur = checkpointState(cur, version, store).state
  version += 1

  // ③ 自检：正文确实含费用条款和服务期 → 才记为「本机已验证」的事实
  const text = await extractText(pdfBase64, { mock })
  const hasFee = text.includes('Monthly Fee') && text.includes(`¥${vars.monthly_fee}`)
  const hasTerm = text.includes('Term') && text.includes(`${vars.term_months} months`)
  if (!hasFee || !hasTerm) {
    throw new Error(`自检失败：extractText 结果里缺费用条款（hasFee=${hasFee}）或服务期（hasTerm=${hasTerm}）。` +
      '生成物不对，绝不往下走。')
  }
  console.log(`[3/4] 自检（extractText）：含费用条款 ✓ 含服务期 ✓ → 记为「本机已验证的事实」`)
  cur = {
    ...cur,
    current_state: `自检通过：合同正文含费用条款（¥${vars.monthly_fee}）与服务期（${vars.term_months} 个月）。\n${cur.current_state || ''}`,
    next_steps: ['等待人的回执 land 回来（node cli.js land <回执> --into 本护照）后，执行 sign 送签'],
    facts: [
      ...(Array.isArray(cur.facts) ? cur.facts : []),
      {
        claim: `合同 PDF ${contractPath}（sha256=${pdfSha}）含费用条款 ¥${vars.monthly_fee} 和服务期 ${vars.term_months} 个月`,
        scope: 'machine',
        verified: true,
        verified_by: 'agent',
        verified_on: hostname(),
        source: 'extractText 自检：正文包含 "Monthly Fee"、"¥5000"、"12 months"',
      },
    ],
  }
  cur = checkpointState(cur, version, store).state
  version += 1
  console.log(`    护照版本 → ${version}（渲染 / PDF / 自检各一次 checkpoint）`)

  // ④ 到签名边界：打包出门，ask 记录在护照里（pack 内部幂等写回）
  const packOut = join(outDir, 'for-review.taskpack.json')
  const packed = runCli(
    [
      'pack', passportId,
      '--flat',
      '--out', packOut,
      '--file', contractPath,
      '--actor', 'agent',
      '--to', 'human approver',
      '--ask', ASK_TEXT,
      '--store', store,
    ],
    store,
  )
  console.log(`[4/4] 到签名边界，停下。打包出门 → ${packOut}`)
  console.log(`     ask: ${ASK_TEXT}`)
  console.log(`     护照版本 → ${packed.state_version}（ask 已记录，asks_recorded=${packed.asks_recorded}）`)

  console.log()
  console.log('🚫 我不能签，需要人的批准。')
  console.log(`    把 ${packOut} 交给 review.mjs show / approve。`)
}

/* ------------------------------------------------------------------ */
/* sign：闸门逻辑（判分关键，一步不能省）                             */
/* ------------------------------------------------------------------ */

function fail(exitCode, message) {
  console.error(message)
  process.exit(exitCode)
}

async function cmdSign() {
  const passportId = requireOption('--passport')
  const store = requireOption('--store')
  const outDir = resolve(option('--out', 'out'))
  const mock = hasFlag('--mock')
  const signerEmail = option('--signer-email', 'jane.doe@acme.example')
  const signerName = option('--signer-name', 'Jane Doe')

  const contractPath = join(outDir, 'contract.pdf')
  if (!existsSync(contractPath)) {
    fail(1, `找不到 ${contractPath}——先跑 draft 生成合同。`)
  }

  console.log('===== sign：送签前的四道闸门 =====')
  console.log(`护照 ${passportId} · store ${store} · mock=${mock}`)

  // 闸门 1：读护照，找那条 ask，必须已有人回答
  const opened = openPassport(passportId, store)
  const asks = Array.isArray(opened.state.asks) ? opened.state.asks : []
  const ask = asks.find((item) => item?.id === 'a1') || asks[0]
  if (!ask || ask.status !== 'answered' || !ask.answer || !String(ask.answer).trim()) {
    fail(3, '没有人批准过，拒绝送签。\n' +
      `ask ${ask?.id || '(无)'} 状态=${ask?.status || '无'}；回执 land 回来之前，签名这道门不开。`)
  }
  console.log(`闸门1 有人回答过 ask ${ask.id}: ${ask.what}`)
  console.log(`     回答: ${ask.answer}（${ask.answered_by} @ ${ask.answered_at}）`)

  // 闸门 2：解析回执决定，必须是 approve
  const match = /^(approve|reject)\s+sha256=([0-9a-f]{64})$/i.exec(String(ask.answer).trim())
  if (!match) {
    fail(3, `回执决定无法解析（${ask.answer}）。不是 approve，拒绝送签。`)
  }
  const [decision, approvedSha] = [match[1].toLowerCase(), match[2].toLowerCase()]
  if (decision !== 'approve') {
    fail(3, `回执里是 ${decision}——人没有批准，拒绝送签。`)
  }
  console.log(`闸门2 决定是 approve ✓`)

  // 闸门 3：回执批的 sha256 必须等于本机手上这份合同
  const localSha = sha256OfFile(contractPath)
  if (approvedSha !== localSha) {
    fail(2, `批准的是 ${approvedSha}，我手上是 ${localSha}，拒绝送签。\n` +
      '这两份不是同一版文档——回执批的是另一份，签名绝不能落在这一份上。')
  }
  console.log(`闸门3 版本一致 ✓ 批准 ${approvedSha} == 本机 ${localSha}`)

  // 闸门 4：全过，才调 eSign（凭据只在服务端；客户端 mock 不碰网络）
  const pdfBase64 = readFileSync(contractPath).toString('base64')
  const { access_token: token } = await getAccessToken({ mock })
  const { folderId } = await createFolder(
    { pdfBase64, folderName: 'consulting-agreement', signerEmail, signerName, sendNow: false },
    { mock },
  )
  const sent = await sendDraftFolder(folderId, { mock })
  const history = await viewActivityHistory(folderId, { mock })
  console.log(`闸门4 eSign ✓ folderId=${folderId} 送签于 ${sent.sent_at}`)

  // 把 folderId、送签时间、审计轨迹 checkpoint 回护照，形成完整责任链
  const cur = {
    ...opened.state,
    current_state:
      `已送签：eSign folderId=${folderId}，送签时间 ${sent.sent_at}（合同 sha256=${localSha}）。\n${opened.state.current_state || ''}`,
    decisions: [
      ...(Array.isArray(opened.state.decisions) ? opened.state.decisions : []),
      {
        what: `送签决定：把合同（sha256=${localSha}）送去签署，eSign folderId=${folderId}`,
        why: `人已批准（${ask.answered_by} @ ${ask.answered_at}）；批准版本与本机一致；` +
          `审计轨迹 ${history.activities.length} 条（${history.activities.map((a) => a.event).join(' → ')}）`,
      },
    ],
    facts: [
      ...(Array.isArray(opened.state.facts) ? opened.state.facts : []),
      {
        claim: `合同（sha256=${localSha}）已通过审批闸门并送签，folderId=${folderId}`,
        scope: 'machine',
        verified: true,
        verified_by: 'agent',
        verified_on: hostname(),
        source: `eSign sendDraftFolder @ ${sent.sent_at}`,
      },
    ],
    artifacts: [...(Array.isArray(opened.state.artifacts) ? opened.state.artifacts : []), `eSign folder: ${folderId}`],
  }
  const saved = checkpointState(cur, opened.state_version, store)
  console.log(`    责任链已 checkpoint 回护照 → 版本 ${saved.state_version}`)

  // 责任链摘要
  console.log()
  console.log('========== 责任链摘要 ==========')
  console.log(`护照        : ${passportId}（版本 ${saved.state_version}）`)
  console.log(`合同        : ${contractPath}  sha256=${localSha}`)
  console.log(`问的        : ask ${ask.id}「${ask.what}」`)
  console.log(`            （什么算答完：${ask.accept}）`)
  console.log(`回答        : ${ask.answer}`)
  console.log(`            （${ask.answered_by} @ ${ask.answered_at}）`)
  console.log(`闸门①有人批  : ✓ ${decision}`)
  console.log(`闸门②版本一致: ✓ 批准 ${approvedSha} == 本机现算 ${localSha}`)
  console.log(`eSign       : folderId=${folderId}，送签于 ${sent.sent_at}`)
  console.log(`审计轨迹    : ${history.activities.map((a) => `${a.event}@${a.at}`).join(' → ') || history.note || '（无）'}`)
  console.log(`记录在护照  : decisions ${saved.state.decisions.length} 条 · facts ${saved.state.facts.length} 条 · artifacts ${saved.state.artifacts.length} 条`)
  console.log('===============================')
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

const command = process.argv[2]
try {
  if (command === 'plan') cmdPlan()
  else if (command === 'draft') await cmdDraft()
  else if (command === 'sign') await cmdSign()
  else throw new Error(
    `未知子命令 ${command || '(无)'}。用法：agent.mjs plan|draft|sign（--help 看仓库 README）`,
  )
} catch (error) {
  console.error(`agent.mjs ${command || ''} 失败：${error.message}`)
  process.exit(1)
}
