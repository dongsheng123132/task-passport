#!/usr/bin/env node
/**
 * foxit-esign.mjs — Foxit eSign 客户端
 *
 * 这是不可逆动作的那一侧：合同一旦送签，就不是重新生成一次的事了。
 * 所以本文件**不提供「无脑送签」的入口**——调用方（agent.mjs sign）必须先
 * 过完护照里的 ask 闸门，才允许拿到 folderId。
 *
 * 端点事实 2026-08-22 实测校准（eSign 已在开发者后台激活，Account #2907377）：
 *   与赛题文档的旧表述不同，以实测为准：
 *   - 统一 API 网关：POST/GET https://na1.fusion.foxit.com/esign/api/v1/...
 *     （不是老域名 na1.foxitesign.foxit.com，那是遗留 eSign API）
 *   - 鉴权：请求头 client_id / client_secret 两个字段（与 PDF Services 同一套
 *     凭据，不需要 OAuth token——统一平台没有 access_token 流程）
 *   - 建封套（草稿）：POST /esign/api/v1/folders/createfolder
 *     → {"folder":{"folderId":N,"folderStatus":"DRAFT",...}}
 *     实测：sendDraftFolder 要求为签署人分配签名域，否则报
 *     "Please assign a signature field to <姓名>..."——所以 createFolder
 *     必须带 fields:[{type:"signature",...}]（坐标钉在合同第 1 页底部）
 *   - 送签：POST /esign/api/v1/folders/sendDraftFolder {"folderId":N}
 *   - 审计：GET /esign/api/v1/folders/viewActivityHistory?folderId=N
 *     （草稿态报 "logs of a non-shared folder can not be viewed."，代码要容忍）
 *   - 下载：GET /esign/api/v1/folders/download?folderId=N
 *
 * 凭据环境变量：FOXIT_ESIGN_CLIENT_ID / FOXIT_ESIGN_CLIENT_SECRET，
 * 未设时回退到 FOXIT_CLOUD_API_CLIENT_ID / FOXIT_CLOUD_API_CLIENT_SECRET
 * （统一平台同一套，实测可用）。
 *
 * mock 语义：folderId 是确定性的 `MOCK-FOLDER-<sha256前8位>`（任务要求），
 * 由「合同字节 + 签署人 + 发送开关」共同决定——同一份合同给同一个人，永远同一个 folderId；
 * 换一个签名人，folderId 就变，好让 demo 看得见「批的是哪一份」。
 *
 * 零第三方依赖：全局 fetch（Node >= 20）。
 */

import { createHash } from 'node:crypto'

const ESIGN_DEFAULT_HOST = 'https://na1.fusion.foxit.com' // 统一 API 网关（实测）
const ESIGN_PREFIX = '/esign/api/v1'

/* ------------------------------------------------------------------ */
/* 凭据                                                               */
/* ------------------------------------------------------------------ */

function esignConfig() {
  const host = process.env.FOXIT_ESIGN_HOST?.replace(/\/+$/, '') || ESIGN_DEFAULT_HOST
  const clientId =
    process.env.FOXIT_ESIGN_CLIENT_ID || process.env.FOXIT_CLOUD_API_CLIENT_ID
  const clientSecret =
    process.env.FOXIT_ESIGN_CLIENT_SECRET || process.env.FOXIT_CLOUD_API_CLIENT_SECRET
  const missing = [
    clientId ? null : 'FOXIT_ESIGN_CLIENT_ID（或 FOXIT_CLOUD_API_CLIENT_ID）',
    clientSecret ? null : 'FOXIT_ESIGN_CLIENT_SECRET（或 FOXIT_CLOUD_API_CLIENT_SECRET）',
  ].filter(Boolean)
  if (missing.length) {
    throw new Error(
      `Foxit eSign 需要凭据：缺少 ${missing.join('、')}。` +
        '这是与 PDF Services 同一套统一平台凭据；不想碰网络就用 --mock。',
    )
  }
  return { host, clientId, clientSecret }
}

/** 2026-08-22 实测：统一平台鉴权 = client_id / client_secret 两个请求头，无 token。 */
function authHeaders(cfg) {
  return { client_id: cfg.clientId, client_secret: cfg.clientSecret }
}

/* ------------------------------------------------------------------ */
/* mock：确定性假数据                                                 */
/* ------------------------------------------------------------------ */

function mockFolderId(pdfBase64, signer, sendNow) {
  const seed = JSON.stringify({ pdf: String(pdfBase64).slice(0, 1024), signer, sendNow })
  return `MOCK-FOLDER-${createHash('sha256').update(seed).digest('hex').slice(0, 8)}`
}

/* ------------------------------------------------------------------ */
/* 真实调用                                                           */
/* ------------------------------------------------------------------ */

async function postJson(url, body, cfg) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Foxit eSign 请求失败：${error.message}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Foxit eSign ${response.status} ${response.statusText}：${detail}`)
  }
  return response.json()
}

/* ------------------------------------------------------------------ */
/* 公开 API                                                           */
/* ------------------------------------------------------------------ */

/**
 * getAccessToken({ mock }) — 保留签名兼容（agent.mjs 早期版本会调用）。
 * 统一平台实测**没有** OAuth token 流程：鉴权就是 client_id/client_secret 双 header。
 * 真实模式返回 null 并提示；mock 返回确定性假 token（历史行为）。
 */
export async function getAccessToken(options = {}) {
  if (options.mock) {
    return { access_token: 'MOCK-ESIGN-TOKEN-deterministic-00000000' }
  }
  return { access_token: null, note: '统一平台无 token 流程，鉴权走 client_id/client_secret 头' }
}

/**
 * createFolder({ pdfBase64, folderName, signerEmail, signerName, sendNow }, { mock })
 * → { folderId }
 * 实测（2026-08-22）：POST /esign/api/v1/folders/createfolder，body 结构照抄
 * 官方 Quick Start：parties + fields（signature 域必须给签署人，否则送签报错）。
 * 返回 {"folder":{"folderId":N,...}}。
 */
export async function createFolder(input, options = {}) {
  const {
    pdfBase64 = '',
    folderName = 'consulting-agreement',
    signerEmail = '',
    signerName = '',
    sendNow = false,
  } = input || {}
  const [firstName, ...rest] = String(signerName || '').trim().split(/\s+/)
  const lastName = rest.join(' ')

  if (options.mock) {
    return { folderId: mockFolderId(pdfBase64, { signerEmail, signerName }, sendNow) }
  }
  if (!pdfBase64) throw new Error('真实模式 createFolder 需要 pdfBase64')

  const cfg = esignConfig()
  const json = await postJson(
    `${cfg.host}${ESIGN_PREFIX}/folders/createfolder`,
    {
      folderName,
      inputType: 'base64',
      base64FileString: [pdfBase64],
      fileNames: ['agreement.pdf'],
      processTextTags: false,
      processAcroFields: false,
      sendNow,
      // 实测：不给签署人分配签名域，sendDraftFolder 会拒绝。
      // 签名域钉在第 1 页底部中段（官方示例同款坐标）。
      fields: [
        {
          type: 'signature',
          x: 336,
          y: 578,
          width: 170,
          height: 28,
          documentNumber: 1,
          pageNumber: 1,
          tabOrder: 1,
          party: 1,
          required: true,
        },
      ],
      parties: [
        {
          permission: 'FILL_FIELDS_AND_SIGN',
          firstName: firstName || '',
          lastName,
          emailId: signerEmail,
          sequence: 1,
          partyRole: 'Signer',
        },
      ],
    },
    cfg,
  )
  const folderId = json?.folder?.folderId
  if (!folderId) {
    throw new Error(`Foxit eSign createfolder 返回里没有 folder.folderId：${JSON.stringify(json).slice(0, 300)}`)
  }
  return { folderId }
}

/**
 * sendDraftFolder(folderId, { mock }) → { ok, sent_at }
 * 实测：POST /esign/api/v1/folders/sendDraftFolder {"folderId":N}
 */
export async function sendDraftFolder(folderId, options = {}) {
  if (!folderId) throw new Error('folderId 是必填的')
  if (options.mock) {
    return { ok: true, sent_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }
  }
  const cfg = esignConfig()
  const json = await postJson(`${cfg.host}${ESIGN_PREFIX}/folders/sendDraftFolder`, { folderId }, cfg)
  return { ok: true, sent_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), raw: json }
}

/**
 * viewActivityHistory(folderId, { mock }) → { activities, draft }
 * 实测：GET /esign/api/v1/folders/viewActivityHistory?folderId=N；
 * 草稿态报 "logs of a non-shared folder can not be viewed."——容忍它，
 * 返回 draft:true 而不是把 demo 炸掉（与任务文档表述一致）。
 */
export async function viewActivityHistory(folderId, options = {}) {
  if (!folderId) throw new Error('folderId 是必填的')
  if (options.mock) {
    return {
      draft: false,
      activities: [
        { event: 'FOLDER_CREATED', at: '2026-08-19T00:00:00Z', actor: 'agent' },
        { event: 'DRAFT_READY', at: '2026-08-19T00:00:01Z', actor: 'agent' },
        { event: 'SENT', at: '2026-08-19T00:00:02Z', actor: 'agent' },
      ],
    }
  }
  const cfg = esignConfig()
  const url = `${cfg.host}${ESIGN_PREFIX}/folders/viewActivityHistory?folderId=${encodeURIComponent(folderId)}`
  let response
  try {
    response = await fetch(url, {
      headers: { ...authHeaders(cfg) },
      signal: AbortSignal.timeout(60_000),
    })
  } catch (error) {
    throw new Error(`Foxit eSign 请求失败：${error.message}`)
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 500)
    throw new Error(`Foxit eSign ${response.status} ${response.statusText}：${detail}`)
  }
  const json = await response.json()
  if (json?.result === 'error' && /logs of a non-shared folder can not be viewed/i.test(json.error_description || '')) {
    return { draft: true, activities: [], note: '草稿态没有审计轨迹（Foxit 行为，已核实）' }
  }
  return { draft: false, activities: Array.isArray(json) ? json : json?.activities || [] }
}

/* ------------------------------------------------------------------ */
/* CLI 冒烟：node foxit-esign.mjs --mock                               */
/* ------------------------------------------------------------------ */

if (process.argv[1] && process.argv[1].endsWith('foxit-esign.mjs')) {
  const { access_token: token } = await getAccessToken({ mock: true })
  const { folderId } = await createFolder(
    { pdfBase64: Buffer.from('%PDF-1.4 mock').toString('base64'), signerEmail: 'a@b.c', signerName: 'Jane Doe' },
    { mock: true },
  )
  const sent = await sendDraftFolder(folderId, { mock: true })
  const history = await viewActivityHistory(folderId, { mock: true })
  console.log(JSON.stringify({ ok: true, token, folderId, sent, history }, null, 2))
}