#!/usr/bin/env node
/**
 * review.mjs — 人这一侧（薄壳，不重新实现 pack 解析，全走 cli.js）
 *
 * 剧情：agent 把 TaskPack 送到人面前。人用 show 看清三件事——
 *   ① agent 做了哪几步
 *   ② 它声称的事实里，哪些在你这台机器上是「未证」（打包时已封存，本仓库最原创的一条）
 *   ③ 文档 sha256 是多少、它在问什么
 * 然后 approve（或 --reject）。回执按 receipt 语义打回：land --into 能把它
 * 合并回**提问的那本**护照（lineage.root_id 必须等于原护照 id）。
 *
 * 子命令：
 *   show <pack.json>
 *   approve <pack.json> --into-store <human-store> --actor "<name>" [--reject] [--out <dir>]
 *
 * 零第三方依赖：node:crypto、node:fs、node:path、node:child_process。
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..')
const CLI = join(REPO_ROOT, 'cli.js')

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

function readFlatPack(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (raw?.encoding !== 'flat' || !raw?.passport) {
    throw new Error(`${path} 不是 flat 编码的 .taskpack.json（encoding=${raw?.encoding}）`)
  }
  return raw
}

/** 人看到的附件 = 包里带的文件。approve 之前先自己验一遍哈希，包被改过就直接拒绝。 */
function verifyAttachment(pack) {
  const attachment = (pack.attachments || []).find((item) => item?.name && item?.sha256)
  if (!attachment) throw new Error('包里没有任何附件（合同 PDF 呢？）——拒绝审批')
  const bytes = attachment.encoding === 'base64'
    ? Buffer.from(String(attachment.data), 'base64')
    : Buffer.from(String(attachment.data), 'utf8')
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== attachment.sha256) {
    throw new Error(`附件 ${attachment.name} 哈希不符：声明 ${attachment.sha256}，实算 ${actual}。包被改过，拒绝审批。`)
  }
  return attachment
}

/* ------------------------------------------------------------------ */
/* show：人类可读地打印包里有什么                                      */
/* ------------------------------------------------------------------ */

function cmdShow() {
  const packPath = resolve(process.argv[3])
  const pack = readFlatPack(packPath)
  const bag = pack.passport
  const state = bag.passport || {}
  const facts = Array.isArray(state.facts) ? state.facts : []
  const asks = Array.isArray(bag.asks) ? bag.asks : []
  const checks = Array.isArray(bag.landing_checks) ? bag.landing_checks : []
  const attachments = Array.isArray(pack.attachments) ? pack.attachments : []

  console.log(`=== TaskPack（${bag.kind}，flat）===\n`)
  console.log(`来自    : ${bag.origin?.actor || '(未署名)'}@${bag.origin?.machine || '?'}`)
  console.log(`打包于  : ${bag.packed_at || '?'}`)
  console.log(`血缘    : ${bag.lineage?.root_id || '?'}@${bag.lineage?.from_version ?? '?'}`)
  if (bag.note) console.log(`说明    : ${bag.note}`)

  console.log('\n—— 任务 ——')
  console.log(`标题    : ${state.title || '?'}`)
  console.log(`目标    : ${state.goal || '?'}`)
  console.log(`当前状态: ${String(state.current_state || '').slice(0, 400)}`)

  console.log('\n—— agent 声称的事实（区分「可信」与「在你这台机器上未证」）——')
  if (!facts.length) console.log('  （无）')
  for (const fact of facts) {
    if (fact?.needs_reverify) {
      console.log(`  ⚠️ 未证  [${fact.scope || 'machine'}] ${fact.claim}`)
      console.log(`        曾在 ${fact.verified_on || '?'} 上验证过——那是另一台机器，打包时已封存。`)
      console.log(`        在你这台机器上先重验再用，别当事实。`)
    } else if (fact?.verified) {
      console.log(`  ✓ 可信  [${fact.scope || 'machine'}] ${fact.claim}`)
    } else {
      console.log(`  ⚠️ 未证  [${fact.scope || 'machine'}] ${fact.claim}（没标 verified）`)
    }
    if (fact?.source) console.log(`        来源：${fact.source}`)
  }

  console.log('\n—— 行李 ——')
  if (!attachments.length) console.log('  （无）')
  for (const item of attachments) {
    console.log(`  - ${item.name}（${item.bytes} 字节）`)
    console.log(`    sha256=${item.sha256}`)
  }

  console.log('\n—— 它在问什么 ——')
  if (!asks.length) console.log('  （无）')
  for (const ask of asks) {
    console.log(`  [${ask.id} → ${ask.to}] ${ask.what}`)
    if (ask.why) console.log(`    为什么: ${ask.why}`)
    console.log(`    什么算答完: ${ask.accept}`)
    console.log(`    状态: ${ask.status}${ask.answer ? ` | 回答: ${ask.answer}` : ''}`)
  }

  if (checks.length) {
    console.log('\n—— 落地自检（它希望你收到后先跑）——')
    for (const check of checks) {
      console.log(`  [${check.id}]${check.required ? '【必做】' : ''} ${check.check}（${check.how || '怎么做未给'}）`)
    }
  }

  console.log('\n—— agent 的下一步 ——')
  for (const step of Array.isArray(state.next_steps) ? state.next_steps : []) {
    console.log(`  - ${step}`)
  }

  console.log('\n==============================')
  console.log('决策权在你：approve 或 --reject。回执会带上「你看到的那份 PDF 的 sha256」。')
}

/* ------------------------------------------------------------------ */
/* approve：land 进人这边的 store → 写决定 → 打回执                   */
/* ------------------------------------------------------------------ */

function cmdApprove() {
  const packPath = resolve(process.argv[3])
  const store = requireOption('--into-store')
  const actor = requireOption('--actor')
  const reject = hasFlag('--reject')
  const outDir = resolve(option('--out', 'out'))

  const pack = readFlatPack(packPath)
  const bag = pack.passport
  const rootId = bag.lineage?.root_id
  if (!rootId) throw new Error('包里没有 lineage.root_id，这不是合法 TaskPack')

  const attachment = verifyAttachment(pack)
  const sha = attachment.sha256

  console.log(`=== 人这一侧：${reject ? 'reject（拒绝）' : 'approve（批准）'} ===`)
  console.log(`包来自  : ${bag.origin?.actor || '?'}@${bag.origin?.machine || '?'}`)
  console.log(`回答哪本: ${rootId}`)
  console.log(`看到哪版: ${attachment.name}  sha256=${sha}`)

  // ① 收进人这边的 store（开新护照，跟 agent 那本是两本——各自为自己的记录负责）
  const landed = runCli(['land', packPath, '--store', store], store)
  const humanId = landed.passport_id
  console.log(`已 land 进 human store（${humanId}）`)

  // ② 读回来，写人的决定 + 把 ask 标成 answered
  const opened = runCli(['open', humanId, '--store', store], store)
  const asks = (Array.isArray(opened.state.asks) ? opened.state.asks : []).map((ask) => ({
    ...ask,
    status: 'answered',
    answer: `${reject ? 'reject' : 'approve'} sha256=${sha}`,
  }))
  if (!asks.length) throw new Error('包里没有 ask，没有可回答的问题——这不该发生')

  const decision = {
    what: `${actor} 决定${reject ? '拒绝' : '批准'}把合同送去签署`,
    why: `看到的是 ${attachment.name}（sha256=${sha}）。${reject ? '人没有批准。' : '人已批准。'}`,
  }

  // ③ 回执必须指向提问的那本护照：把 id 改回 lineage.root_id（land 会新开 id，
  //    但 mergeReceipt 只认 root_id 等于目标护照 id 的回执——方向相反，规则相反）
  const state = {
    ...opened.state,
    id: rootId,
    asks,
    decisions: [...(Array.isArray(opened.state.decisions) ? opened.state.decisions : []), decision],
    current_state:
      `${actor} 的${reject ? '拒绝' : '批准'}决定已写入（sha256=${sha}）。\n${opened.state.current_state || ''}`,
  }
  const stateFile = join(outDir, `human-decision-${rootId}.json`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(stateFile, JSON.stringify(state))
  // human store 里还没有以 rootId 命名的文件（land 用的是新 id），基线版本是 0
  const saved = runCli(
    ['checkpoint', '--file', stateFile, '--expected-version', '0', '--store', store],
    store,
  )
  rmSync(stateFile, { force: true })
  // land 出来的那本新护照已经没用了（决定写进了 rootId 这本），清掉避免 store 里有两本
  rmSync(join(store, `${humanId}.json`), { force: true })
  rmSync(join(store, `${humanId}.files`), { recursive: true, force: true })

  // ④ 打包回执（receipt 语义：答案回家，不新开任务）
  const asksFile = join(outDir, `receipt-asks-${rootId}.json`)
  writeFileSync(asksFile, JSON.stringify(asks))
  const receiptOut = join(outDir, 'receipt.taskpack.json')
  const receipt = runCli(
    [
      'pack', rootId,
      '--kind', 'receipt',
      '--flat',
      '--out', receiptOut,
      '--actor', actor,
      '--asks', asksFile,
      '--store', store,
    ],
    store,
  )
  rmSync(asksFile, { force: true })

  console.log(`决定已写进 human store（护照版本 ${saved.state_version}）`)
  console.log(`回执已打包: ${receiptOut}（asks_recorded=${receipt.asks_recorded}）`)
  console.log()
  console.log('把回执 land 回 agent 那本护照（答案合并回原 ask，不新开护照）：')
  console.log(`  node cli.js land ${receiptOut} --into ${rootId} --store <agent-store>`)
  console.log()
  console.log(`回执里的回答: ${asks.map((a) => `${a.id}: ${a.answer}`).join(' | ')}`)
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

const command = process.argv[2]
try {
  if (command === 'show') cmdShow()
  else if (command === 'approve') cmdApprove()
  else throw new Error(
    `未知子命令 ${command || '(无)'}。用法：review.mjs show <pack.json> | approve <pack.json> --into-store <dir> --actor <name> [--reject]`,
  )
} catch (error) {
  console.error(`review.mjs ${command || ''} 失败：${error.message}`)
  process.exit(1)
}
