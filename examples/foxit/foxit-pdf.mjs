#!/usr/bin/env node
/**
 * foxit-pdf.mjs — Foxit PDF Services 客户端（薄封装）
 *
 * 这是 Foxit 赛题 demo 的「可逆操作」一侧：生成 / 提取 / 压缩都随时可以重来，
 * 所以 agent 可以自己干，不需要人批准。签名不在这一侧——签名在 foxit-esign.mjs，
 * 而那一边由 agent.mjs 的 ask 闸门挡着。
 *
 * 端点事实 2026-08-22 实测校准（沙箱凭据 + /pdf-services/v3/api-docs OpenAPI 规范），
 * 与任务文档的旧表述（GenerateDocumentBase64 + Basic 鉴权）不同，以实测为准：
 *   base: https://na1.fusion.foxit.com/pdf-services
 *   鉴权: 请求头 client_id / client_secret 两个字段（不是 Basic，也不是 Bearer token）
 *   上传: POST /api/documents/upload（multipart，字段 file）→ {documentId}
 *   生成: POST /api/documents/create/pdf-from-html {documentId} → 202 {taskId}
 *   提取: POST /api/documents/convert/pdf-to-text {documentId} → task → 下载 .txt
 *   压缩: POST /api/documents/modify/pdf-compress {documentId, compressionLevel}
 *   任务: GET /api/tasks/{taskId}（PENDING/IN_PROGRESS/COMPLETED/FAILED，结果在
 *         resultDocumentId / resultData）
 *   下载: GET /api/documents/{document-id}/download
 *   环境变量: FOXIT_CLOUD_API_HOST / FOXIT_CLOUD_API_CLIENT_ID / FOXIT_CLOUD_API_CLIENT_SECRET
 *
 * mock 模式完全自洽，不依赖任何网络。
 *
 * mock 语义：同样输入 → 同样字节 → 同样 sha256。mock PDF 里内嵌了渲染文本
 * （%TXT: 行），所以 extractText 在 mock 下也能真实地做「自检合同含关键条款」。
 *
 * 零第三方依赖：node:crypto + 全局 fetch（Node >= 20）。
 */

import { createHash } from 'node:crypto'

const PDF_SERVICES_DEFAULT_HOST = 'https://na1.fusion.foxit.com/pdf-services'
const MAX_TEMPLATE_BYTES = 4 * 1024 * 1024 // 任务已核实：模板 4MB 上限

/* ------------------------------------------------------------------ */
/* 凭据与错误                                                          */
/* ------------------------------------------------------------------ */

function pdfConfig() {
  const host = process.env.FOXIT_CLOUD_API_HOST?.replace(/\/+$/, '') || PDF_SERVICES_DEFAULT_HOST
  const clientId = process.env.FOXIT_CLOUD_API_CLIENT_ID
  const clientSecret = process.env.FOXIT_CLOUD_API_CLIENT_SECRET
  const missing = [
    clientId ? null : 'FOXIT_CLOUD_API_CLIENT_ID',
    clientSecret ? null : 'FOXIT_CLOUD_API_CLIENT_SECRET',
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(
      `Foxit PDF Services 需要凭据：缺少 ${missing.join('、')}。` +
        '设好环境变量再跑；不想碰网络就用 --mock。',
    )
  }
  return { host, clientId, clientSecret }
}

/**
 * 2026-08-22 实测：PDF Services 的鉴权不是 Basic 也不是 Bearer token，
 * 而是把 client_id / client_secret 作为两个独立请求头。服务端未配齐时会回
 * "Missing credentials: provide both 'client_id' and 'client_secret' headers."
 * （x-api-key 不需要，OpenAPI spec 里的 securityScheme 与实测网关不符。）
 */
function authHeaders(cfg) {
  return { client_id: cfg.clientId, client_secret: cfg.clientSecret }
}

/* ------------------------------------------------------------------ */
/* mock：确定性假 PDF                                                 */
/* ------------------------------------------------------------------ */

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 确定性 mock PDF：字节完全由输入 html 决定。内嵌一行 %TXT:<JSON 文本>，
 * 让 extractText 的 mock 路径能真实提出文本（自检逻辑不是假的）。
 */
function mockPdfFromHtml(html) {
  const digest = createHash('sha256').update(html, 'utf8').digest('hex')
  const text = JSON.stringify(stripHtml(html))
  const head = Buffer.from(
    `%PDF-1.4\n% task-passport foxit mock — deterministic, ${digest.slice(0, 16)}\n%TXT:${text}\n`,
    'utf8',
  )
  // 填充长度也由输入决定：不同 html 得到不同大小，但同样输入 → 同样字节。
  const padLen = 128 + (Number.parseInt(digest.slice(0, 4), 16) % 1024)
  const pad = Buffer.alloc(padLen, 0x30)
  return Buffer.concat([head, pad, Buffer.from('\n%%EOF\n')])
}

function mockTextFromPdf(pdfBase64) {
  const bytes = Buffer.from(String(pdfBase64).replace(/\s+/g, ''), 'base64')
  const marker = Buffer.from('%TXT:')
  const start = bytes.indexOf(marker)
  if (start < 0) throw new Error('mock PDF 里没有 %TXT: 行，这不是本客户端生成的 mock 文件')
  let cursor = start + marker.length
  const chunk = []
  while (cursor < bytes.length) {
    const byte = bytes[cursor]
    if (byte === 0x0a) break
    chunk.push(byte)
    cursor += 1
  }
  const payload = Buffer.from(chunk).toString('utf8')
  try {
    return JSON.parse(payload)
  } catch {
    throw new Error('mock PDF 的 %TXT: 行不是 JSON 文本')
  }
}

/* ------------------------------------------------------------------ */
/* 真实模式：upload → 操作 → task 轮询 → download（2026-08-22 实测）    */
/* ------------------------------------------------------------------ */

const TASK_POLL_MS = 1_500
const TASK_POLL_MAX = 40 // 单个任务最久约 60s，超时报错而不是无限等
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 // spec：上传最大 100MB

async function postJson(url, body, headers = {}) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Foxit PDF Services 请求失败：${error.message}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Foxit PDF Services ${response.status} ${response.statusText}：${detail}`)
  }
  return response.json()
}

/** 上传文件（multipart，字段名 file——OpenAPI spec 实测）→ documentId */
async function uploadDocument(name, bytes, mime) {
  const cfg = pdfConfig()
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`上传超过 Foxit 的 100MB 上限（${bytes.length} 字节）`)
  }
  const form = new FormData()
  form.append('file', new Blob([bytes], { type: mime }), name)
  let response
  try {
    response = await fetch(`${cfg.host}/api/documents/upload`, {
      method: 'POST',
      headers: { ...authHeaders(cfg) },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Foxit PDF Services 上传失败：${error.message}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Foxit 上传 ${response.status} ${response.statusText}：${detail}`)
  }
  const json = await response.json()
  if (!json.documentId) {
    throw new Error(`Foxit 上传返回里没有 documentId：${JSON.stringify(json).slice(0, 300)}`)
  }
  return json.documentId
}

/** 提交操作（返回 202 {taskId}）并轮询到 COMPLETED/FAILED */
async function runTask(path, body) {
  const cfg = pdfConfig()
  const json = await postJson(`${cfg.host}${path}`, body, { ...authHeaders(cfg) })
  const taskId = json.taskId || json.task?.taskId
  if (!taskId) {
    throw new Error(`Foxit 操作 ${path} 返回里没有 taskId：${JSON.stringify(json).slice(0, 300)}`)
  }
  for (let i = 0; i < TASK_POLL_MAX; i++) {
    await new Promise((resolve) => setTimeout(resolve, TASK_POLL_MS))
    let task
    try {
      const response = await fetch(`${cfg.host}/api/tasks/${encodeURIComponent(taskId)}`, {
        headers: { ...authHeaders(cfg) },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        const detail = (await response.text().catch(() => '')).slice(0, 500)
        throw new Error(`Foxit 查任务 ${response.status} ${response.statusText}：${detail}`)
      }
      task = await response.json()
    } catch (error) {
      throw new Error(`Foxit 任务状态查询失败：${error.message}`)
    }
    if (task.status === 'COMPLETED') return task
    if (task.status === 'FAILED') {
      const err = task.error || {}
      throw new Error(`Foxit 任务失败：${err.code || ''} ${err.message || JSON.stringify(err)}`.trim())
    }
  }
  throw new Error(`Foxit 任务 ${taskId} 轮询超时（超过 ${(TASK_POLL_MS * TASK_POLL_MAX) / 1000}s 未完成）`)
}

/** 下载文档内容 → Buffer */
async function downloadDocument(documentId) {
  const cfg = pdfConfig()
  let response
  try {
    response = await fetch(`${cfg.host}/api/documents/${encodeURIComponent(documentId)}/download`, {
      headers: { ...authHeaders(cfg) },
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Foxit PDF Services 下载失败：${error.message}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Foxit 下载 ${response.status} ${response.statusText}：${detail}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/* ------------------------------------------------------------------ */
/* 公开 API                                                           */
/* ------------------------------------------------------------------ */

/**
 * createPdfFromHtml(html, { mock }) → { pdfBase64, sha256 }
 * 文档生成是「可逆操作」的入口：不满意就重新生成，所以不需要人批准。
 */
export async function createPdfFromHtml(html, options = {}) {
  if (typeof html !== 'string' || !html.trim()) throw new Error('html 是必填的字符串')
  if (options.mock) {
    const bytes = mockPdfFromHtml(html)
    return { pdfBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const cfg = pdfConfig()
  const htmlBytes = Buffer.from(html, 'utf8')
  if (htmlBytes.length > MAX_TEMPLATE_BYTES) {
    throw new Error(`模板超过 Foxit 的 4MB 上限（${htmlBytes.length} 字节）`)
  }
  // 实测流程（2026-08-22）：上传 HTML → documentId → pdf-from-html 异步任务 → 下载结果。
  const documentId = await uploadDocument('contract.html', htmlBytes, 'text/html')
  const task = await runTask('/api/documents/create/pdf-from-html', { documentId })
  if (!task.resultDocumentId) {
    throw new Error(`Foxit 生成任务完成但没有 resultDocumentId：${JSON.stringify(task).slice(0, 300)}`)
  }
  const bytes = await downloadDocument(task.resultDocumentId)
  const pdfBase64 = bytes.toString('base64')
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('Foxit 生成结果不是 PDF（文件头魔术字节不符）')
  }
  return { pdfBase64, sha256: createHash('sha256').update(bytes).digest('hex') }
}

/**
 * extractText(pdfB64, { mock }) → string
 * 用于 agent 自检：生成的合同确实含费用条款和服务期，再往护照里记「本机已验证」。
 * 真实模式 2026-08-22 实测：PDF 上传后走 pdf-to-text 异步任务，完成后的
 * resultDocumentId 是一个 .txt 文档，下载回来即文本。
 */
export async function extractText(pdfBase64, options = {}) {
  if (typeof pdfBase64 !== 'string' || !pdfBase64.trim()) throw new Error('pdfBase64 是必填的字符串')
  if (options.mock) return mockTextFromPdf(pdfBase64)
  const cfg = pdfConfig()
  const bytes = Buffer.from(pdfBase64.replace(/\s+/g, ''), 'base64')
  const documentId = await uploadDocument('document.pdf', bytes, 'application/pdf')
  const task = await runTask('/api/documents/convert/pdf-to-text', { documentId })
  let text
  if (task.resultData) {
    text = typeof task.resultData === 'string' ? task.resultData : task.resultData.text
  }
  if (!text && task.resultDocumentId) {
    text = (await downloadDocument(task.resultDocumentId)).toString('utf8')
  }
  if (!text || typeof text !== 'string') {
    throw new Error(`Foxit 提取任务完成但没有文本结果：${JSON.stringify(task).slice(0, 300)}`)
  }
  return text.trim()
}

/**
 * compress(pdfB64, { mock }) → { pdfBase64, sha256 }
 * 同样是可逆操作。真实模式 2026-08-22 实测：
 * 上传 PDF → pdf-compress {documentId, compressionLevel}（默认 MEDIUM，
 * 可用 FOXIT_COMPRESS_LEVEL 覆盖）→ 任务 → 下载压缩后的 PDF。
 */
export async function compress(pdfBase64, options = {}) {
  if (typeof pdfBase64 !== 'string' || !pdfBase64.trim()) throw new Error('pdfBase64 是必填的字符串')
  if (options.mock) {
    // 压缩是可逆的，mock 也保持确定性：字节 = 原文 + 一条压缩声明行。
    const original = Buffer.from(pdfBase64.replace(/\s+/g, ''), 'base64')
    const bytes = Buffer.concat([
      Buffer.from('%PDF-1.4\n% mock-compressed by task-passport foxit example\n'),
      original,
    ])
    return { pdfBase64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') }
  }
  const cfg = pdfConfig()
  const bytes = Buffer.from(pdfBase64.replace(/\s+/g, ''), 'base64')
  const documentId = await uploadDocument('document.pdf', bytes, 'application/pdf')
  const level = process.env.FOXIT_COMPRESS_LEVEL || 'MEDIUM'
  const task = await runTask('/api/documents/modify/pdf-compress', { documentId, compressionLevel: level })
  if (!task.resultDocumentId) {
    throw new Error(`Foxit 压缩任务完成但没有 resultDocumentId：${JSON.stringify(task).slice(0, 300)}`)
  }
  const out = await downloadDocument(task.resultDocumentId)
  return { pdfBase64: out.toString('base64'), sha256: createHash('sha256').update(out).digest('hex') }
}

/* ------------------------------------------------------------------ */
/* CLI 冒烟：node foxit-pdf.mjs --mock                                 */
/* ------------------------------------------------------------------ */

if (process.argv[1] && process.argv[1].endsWith('foxit-pdf.mjs')) {
  const { pdfBase64, sha256 } = await createPdfFromHtml('<html><body><h1>hello</h1></body></html>', { mock: true })
  const text = await extractText(pdfBase64, { mock: true })
  const again = await createPdfFromHtml('<html><body><h1>hello</h1></body></html>', { mock: true })
  console.log(JSON.stringify({
    ok: true,
    sha256,
    deterministic: sha256 === again.sha256,
    bytes: Buffer.from(pdfBase64, 'base64').length,
    extractText: text,
  }, null, 2))
}
