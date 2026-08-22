/**
 * Task moving box — a self-contained, offline, single-file handoff.
 *
 * The passport carries state; the bag carries the luggage. Like a deck that embeds
 * its fonts, a bag opens on a machine that has none of your paths.
 *
 * Deliberately built on boring standards rather than a new one:
 * - BagIt (IETF RFC 8493) for the layout, manifests and payload checksums
 * - SHA-256 for content digests
 * - ZIP (stored/deflate) for the single file you actually send
 *
 * It never contains credentials, never contains a transcript, and never contains
 * instructions. What to do with a bag is decided by the receiving side's installed
 * tooling, not by anything written inside it.
 */
import { createHash } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const BAG_SPEC = 'task-passport-bag/0.1'

/** Declared in docs/a2a-extension.json. A limit nobody enforces is not a limit. */
export const MAX_INLINE_ATTACHMENT_BYTES = 1_048_576

const CREDENTIAL = /(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/
const TRANSCRIPT = /(^|\n)\s*(User|Assistant|Human|用户|助手)\s*[:：]/

/**
 * Scan field values, not the serialized JSON. Serialization turns a real newline into
 * a two-character escape, which silently defeats any line-anchored pattern.
 */
function stringValues(value, found = []) {
  if (typeof value === 'string') found.push(value)
  else if (Array.isArray(value)) for (const item of value) stringValues(item, found)
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringValues(item, found)
  return found
}

/**
 * Keep a luggage path relative and inside the bag. Each segment is sanitised on its own
 * so folder shape survives, while `..`, absolute paths and drive letters cannot escape
 * `data/files/` on the receiving machine.
 */
function luggagePath(raw) {
  return String(raw || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.replace(/^[A-Za-z]:$/, '').replace(/[^\w.\-（）()一-龥]+/g, '_'))
    .filter((segment) => segment && segment !== '.' && segment !== '..' && segment !== '_')
    .join('/')
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
const utf8 = (text) => Buffer.from(text, 'utf8')

/**
 * Facts that were only ever true on the sender's machine must not arrive wearing a ✓.
 *
 * This downgrades by default, including when the hostname looks familiar. Hostnames
 * collide, and the costs are lopsided: re-checking a path you already have is cheap,
 * while one false ✓ makes the receiving model act confidently on something untrue.
 * Trusting them again is an explicit choice (`trustMachineFacts`), never an inference.
 */
function travelFacts(facts, trustMachineFacts, verifiedOn) {
  return (Array.isArray(facts) ? facts : []).map((fact) => {
    if (!fact || typeof fact !== 'object') return fact
    const scope = fact.scope || 'machine'
    if (trustMachineFacts || (scope !== 'machine' && fact.needs_reverify !== true)) return fact
    // Record where it *was* proven, not just that it is now unproven. A receiver can
    // then tell "this machine is different" from "this machine is the same but I
    // cannot reach that path" — two very different reasons to distrust one claim,
    // and only the second one goes away by opening a directory.
    return { ...fact, verified: false, needs_reverify: true, verified_on: fact.verified_on || verifiedOn || '' }
  })
}

/**
 * An ask is a request aimed at the receiver — the one thing a one-way handoff cannot
 * express. `accept` is the load-bearing field: it states what would count as answered,
 * so the reply can be judged instead of negotiated.
 */
function normalizeAsks(asks) {
  return (Array.isArray(asks) ? asks : [])
    .filter((ask) => ask && typeof ask === 'object')
    .map((ask, index) => ({
      id: String(ask.id || `a${index + 1}`),
      to: String(ask.to || 'peer'),
      what: String(ask.what || '').trim(),
      why: String(ask.why || '').trim(),
      accept: String(ask.accept || '').trim(),
      status: ask.status === 'answered' || ask.status === 'dropped' ? ask.status : 'open',
      answer: ask.answer ?? null,
      // Optional, and only ever written by a receipt merge. An answer with no attribution
      // is a fact with no source: still useful, but you cannot go back and ask who said it.
      // Emitted only when present, so a pack that never saw a receipt is byte-identical.
      ...(ask.answered_by ? { answered_by: String(ask.answered_by) } : {}),
      ...(ask.answered_at ? { answered_at: String(ask.answered_at) } : {}),
    }))
}

/**
 * A landing check turns "trust me, it works" into something the receiver runs locally.
 * Required ones gate the handoff; that step is the entire difference between this and
 * mailing someone a document.
 */
function normalizeLandingChecks(checks) {
  return (Array.isArray(checks) ? checks : [])
    .filter((check) => check && typeof check === 'object')
    .map((check, index) => ({
      id: String(check.id || `c${index + 1}`),
      check: String(check.check || '').trim(),
      how: String(check.how || '').trim(),
      required: check.required !== false,
    }))
    .filter((check) => check.check)
}

/**
 * Build a bag in memory. Returns an ordered map of bag-relative path -> Buffer.
 * `files` is [{ name, data }]; callers read from disk so this stays testable.
 */
export function buildBag({
  state,
  files = [],
  actor = '',
  machine = '',
  note = '',
  kind = 'handoff',
  asks = [],
  landingChecks = [],
}) {
  if (!state || typeof state !== 'object' || !state.id) throw new Error('state with an id is required')

  const passport = {
    spec: BAG_SPEC,
    kind: kind === 'receipt' ? 'receipt' : 'handoff',
    packed_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    origin: { actor: String(actor || ''), machine: String(machine || ''), harness: state.harness || '' },
    lineage: { root_id: state.id, from_version: Number(state.version || 0), chain: [`${state.id}@${state.version || 0}`] },
    note: String(note || ''),
    passport: state,
    asks: normalizeAsks(asks),
    landing_checks: normalizeLandingChecks(landingChecks),
  }
  return assembleBag(passport, files)
}

/**
 * Assemble BagIt entries from an ALREADY-BUILT passport object. Split out from
 * buildBag so the flat `.taskpack.json` encoding can be converted back into a bag
 * byte-for-byte — a round trip that mints a fresh `packed_at` is not a round trip.
 *
 * Every refusal lives here, because this is the single chokepoint every encoding
 * passes through. A caller that assembles its own entries is out of contract.
 */
export function assembleBag(passport, files = []) {
  // Downgrade machine-scoped facts HERE, at pack time, not at landing time.
  // A safety property that depends on the receiver running the right code is not a
  // property of the format — a third-party lander that forgets it would import false
  // ✓s and never know. Put it in the bytes instead, where every reader sees it.
  // travelFacts is idempotent, so a pack re-assembled from the flat form is unchanged.
  const state = passport.passport
    ? { ...passport.passport, facts: travelFacts(passport.passport.facts, false, passport.origin?.machine || '') }
    : {}
  const sealed = passport.passport ? { ...passport, passport: state } : passport
  const passportJson = `${JSON.stringify(sealed, null, 2)}\n`

  const blocked = []
  for (const text of stringValues(passport)) {
    if (CREDENTIAL.test(text)) blocked.push('the passport looks like it carries a credential')
    if (TRANSCRIPT.test(text)) blocked.push('the passport looks like it carries a chat transcript')
  }
  // An ask without an acceptance rule is not a request, it is another round of chat.
  for (const ask of Array.isArray(passport.asks) ? passport.asks : []) {
    if (!ask?.accept) blocked.push(`ask ${ask?.id || '(未编号)'} has no accept rule — what would count as answered?`)
    if (!ask?.what) blocked.push(`ask ${ask?.id || '(未编号)'} has no request text`)
  }

  const actor = passport.origin?.actor || ''
  const machine = passport.origin?.machine || ''
  const payload = new Map([['data/passport.json', utf8(passportJson)]])
  for (const file of files) {
    const name = luggagePath(file.name)
    if (!name) continue
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), 'utf8')
    if (CREDENTIAL.test(data.subarray(0, 65_536).toString('utf8'))) {
      blocked.push(`${name} looks like it carries a credential`)
    }
    payload.set(`data/files/${name}`, data)
  }
  if (blocked.length) throw new Error(`refusing to pack: ${[...new Set(blocked)].join('; ')}`)

  const manifest = [...payload].map(([path, data]) => `${sha256(data)}  ${path}`).join('\n') + '\n'
  const octets = [...payload.values()].reduce((sum, data) => sum + data.length, 0)
  const bagit = 'BagIt-Version: 1.0\nTag-File-Character-Encoding: UTF-8\n'
  const bagInfo = [
    `Bag-Software-Agent: task-passport`,
    `Bagging-Date: ${passport.packed_at.slice(0, 10)}`,
    `External-Identifier: ${state.id}`,
    `External-Description: ${String(state.title || state.id).replace(/[\r\n]+/g, ' ').slice(0, 200)}`,
    `Source-Organization: ${String(actor || 'unknown').replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
    `Internal-Sender-Identifier: ${String(machine || 'unknown').replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
    `Payload-Oxum: ${octets}.${payload.size}`,
    `Bag-Spec: ${passport.spec || BAG_SPEC}`,
  ].join('\n') + '\n'

  const tags = new Map([
    ['bagit.txt', utf8(bagit)],
    ['bag-info.txt', utf8(bagInfo)],
    ['manifest-sha256.txt', utf8(manifest)],
  ])
  const tagManifest = [...tags].map(([path, data]) => `${sha256(data)}  ${path}`).join('\n') + '\n'

  return new Map([...tags, ['tagmanifest-sha256.txt', utf8(tagManifest)], ...payload])
}

/** Verify a bag against its own manifests. Returns { ok, errors, passport }. */
export function verifyBag(entries) {
  const errors = []
  const read = (path) => entries.get(path)
  const parseManifest = (text) =>
    String(text || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([0-9a-f]{64})\s+(.+)$/)
        return match ? { digest: match[1], path: match[2] } : null
      })
      .filter(Boolean)

  if (!read('bagit.txt')) errors.push('missing bagit.txt — not a BagIt bag')
  for (const name of ['manifest-sha256.txt', 'tagmanifest-sha256.txt']) {
    if (!read(name)) errors.push(`missing ${name}`)
  }

  for (const manifestName of ['manifest-sha256.txt', 'tagmanifest-sha256.txt']) {
    for (const { digest, path } of parseManifest(read(manifestName)?.toString('utf8'))) {
      const data = read(path)
      if (!data) errors.push(`${path} is listed in ${manifestName} but missing from the bag`)
      else if (sha256(data) !== digest) errors.push(`${path} does not match its ${manifestName} digest`)
    }
  }
  // Payload files that nobody vouched for are as bad as corrupted ones.
  const claimed = new Set(parseManifest(read('manifest-sha256.txt')?.toString('utf8')).map((e) => e.path))
  for (const path of entries.keys()) {
    if (path.startsWith('data/') && !claimed.has(path)) errors.push(`${path} is in the bag but not in manifest-sha256.txt`)
  }

  let passport = null
  try {
    passport = JSON.parse((read('data/passport.json')?.toString('utf8') || '').replace(/^﻿/, ''))
  } catch (error) {
    errors.push(`data/passport.json is not readable JSON: ${error.message}`)
  }
  if (passport && passport.spec !== BAG_SPEC) errors.push(`unsupported bag spec: ${passport.spec}`)

  return { ok: errors.length === 0, errors, passport }
}

/**
 * Turn a verified bag into the state for a NEW local passport.
 * One task keeps one authoritative store, so the sender's id is recorded as lineage
 * rather than reused. Facts that only held on the sender's machine arrive unproven.
 */
export function unpackState(bagPassport, { machine = '', localId, files = [], trustMachineFacts = false } = {}) {
  const sent = bagPassport.passport
  const from = `${bagPassport.origin?.actor || '未署名'}@${bagPassport.origin?.machine || '未署名机器'}`
  const lineageTag = `${bagPassport.lineage.root_id}@${bagPassport.lineage.from_version}`
  // Facts arrive already downgraded (assembleBag seals them). Landing can only ever
  // restore a ✓ for facts that were proven on THIS machine — which the pack records
  // in `verified_on`. That turns "trust me" into a claim the code can check itself,
  // and makes the flag useless for laundering someone else's unverified facts.
  const facts = travelFacts(sent.facts, false, bagPassport.origin?.machine || '').map((fact) => {
    if (!trustMachineFacts || !fact || typeof fact !== 'object') return fact
    if (!fact.needs_reverify || !fact.verified_on || !machine || fact.verified_on !== machine) return fact
    return { ...fact, verified: true, needs_reverify: false }
  })
  const pending = facts.filter((fact) => fact?.needs_reverify).length
  const asks = normalizeAsks(bagPassport.asks).filter((ask) => ask.status === 'open')
  const checks = normalizeLandingChecks(bagPassport.landing_checks)
  const required = checks.filter((check) => check.required)

  return {
    ...sent,
    id: localId,
    version: 0,
    machine_id: machine,
    facts,
    asks: normalizeAsks(bagPassport.asks),
    landing_checks: checks,
    artifacts: [
      ...(Array.isArray(sent.artifacts) ? sent.artifacts : []),
      `搬家自 ${from}（血缘 ${lineageTag}）`,
      ...files.map((name) => `行李：${name}`),
    ],
    next_steps: [
      // Order is the message: prove the ground before walking on it, then answer what
      // was asked of you, and only then continue the sender's own list.
      ...required.map((check) => `落地自检【必做】${check.check}${check.how ? `（怎么做：${check.how}）` : ''}`),
      ...(pending ? [`先重验标了 ⚠️ 的 ${pending} 条事实再动手——它们只在 ${bagPassport.origin?.machine || '发出方'} 上验证过；若本机同名，多半是够不着而非失效`] : []),
      ...asks.map((ask) => `回答 ask ${ask.id}：${ask.what}（什么算答完：${ask.accept}）`),
      ...(Array.isArray(sent.next_steps) ? sent.next_steps : []),
    ],
    current_state: `搬家自 ${from}（血缘 ${lineageTag}）。\n\n${sent.current_state || ''}`,
  }
}

/**
 * Fold the asks a pack is carrying into the passport that is sending it.
 *
 * The passport is the record that stays home, and "what I am waiting on someone else
 * for" is part of the task's state, not a property of one envelope. Recording it is
 * also the precondition for `mergeReceipt`: an answer can only come home to a question
 * the record remembers asking.
 *
 * Returns `null` when nothing changed, so re-packing the same asks does not churn the
 * version and lose someone else's concurrent write to a version conflict.
 */
export function recordSentAsks(existing, sent) {
  const held = normalizeAsks(existing)
  const byId = new Map(held.map((ask) => [ask.id, ask]))
  const merged = []
  for (const ask of normalizeAsks(sent)) {
    const previous = byId.get(ask.id)
    if (!previous) {
      merged.push(ask)
      continue
    }
    // Re-sending a question you already asked must not erase the answer you already
    // have. Wording may be refreshed; the reply and who gave it survive.
    byId.set(ask.id, {
      ...previous,
      to: ask.to,
      what: ask.what,
      why: ask.why,
      accept: ask.accept,
    })
  }
  const next = [...byId.values(), ...merged]
  return JSON.stringify(next) === JSON.stringify(held) ? null : next
}

/**
 * Fold a receipt back into the passport that asked the questions.
 *
 * `unpackState` mints a NEW passport, which is right for a handoff: two machines each
 * hold a record that is authoritative for itself. A receipt is the opposite motion —
 * it is the answer coming home to a task you already own. Landing it into a new
 * passport leaves the original's asks sitting `open` forever and makes a human retype
 * every answer, which is exactly the "nothing gets dropped" promise this format makes
 * and would then break on the last step.
 *
 * So the merge is deliberately narrow. It writes answers, adopts facts the far side
 * proved, and adds questions they aimed back at us. It never touches our goal, our
 * current state or our next steps — an answer is not a licence to rewrite the task.
 */
export function mergeReceipt(bagPassport, target, { machine = '', now = new Date() } = {}) {
  if (!target || typeof target !== 'object' || !target.id) throw new Error('target passport state with an id is required')
  // A handoff carries someone's whole world; folding that into an existing passport
  // would silently pick a winner between two current_states. §3.1 says mint a new id,
  // and this is where that rule is enforced rather than explained.
  if (bagPassport?.kind !== 'receipt') {
    throw new Error(
      `refusing to merge: this pack is a ${bagPassport?.kind || '(未声明)'}, not a receipt. ` +
      'Land it without --into — a handoff must open its own passport so one task keeps one authoritative record.',
    )
  }
  const rootId = bagPassport.lineage?.root_id
  if (rootId !== target.id) {
    throw new Error(
      `refusing to merge: this receipt answers ${rootId || '(无血缘)'}, but you are merging into ${target.id}. ` +
      'Merging an answer into the wrong task is worse than not merging it.',
    )
  }

  const from = `${bagPassport.origin?.actor || '未署名'}@${bagPassport.origin?.machine || '未署名机器'}`
  const at = now.toISOString().replace(/\.\d{3}Z$/, 'Z')
  const incoming = normalizeAsks(bagPassport.asks)
  const mine = normalizeAsks(target.asks)
  const byId = new Map(mine.map((ask) => [ask.id, ask]))

  const answered = []
  const reopened = []
  const inbound = []
  for (const ask of incoming) {
    const held = byId.get(ask.id)
    if (!held) {
      // Not one of ours. The far side is asking US something — the one thing a
      // one-way handoff cannot express, arriving in the one direction that can.
      inbound.push({ ...ask, to: 'self', status: 'open', answer: null })
      continue
    }
    const hasAnswer = ask.status === 'answered' && ask.answer !== null && String(ask.answer).trim() !== ''
    if (!hasAnswer) continue
    // Overwriting an existing answer is legitimate (they changed their mind) but it is
    // never silent: a merge that quietly replaces a decision is how a record starts lying.
    if (held.status === 'answered' && String(held.answer ?? '') !== String(ask.answer)) {
      reopened.push({ id: ask.id, was: held.answer, now: ask.answer })
    }
    held.answer = ask.answer
    held.status = 'answered'
    held.answered_by = from
    held.answered_at = at
    answered.push(ask.id)
  }

  // Facts they proved. Sealed at their pack time already; travelFacts is idempotent, so
  // running it again costs nothing and protects against a hand-built receipt.
  const known = new Set((Array.isArray(target.facts) ? target.facts : []).map((fact) => String(fact?.claim || '')))
  const adopted = travelFacts(bagPassport.passport?.facts, false, bagPassport.origin?.machine || '')
    .filter((fact) => fact?.claim && !known.has(String(fact.claim)))
    .map((fact) => ({ ...fact, source: fact.source ? `${fact.source}（经 ${from} 回执）` : `${from} 回执` }))

  const asks = [...mine, ...inbound]
  const stillOpen = asks.filter((ask) => ask.status === 'open')
  const note = `收到 ${from} 的回执（${at}）：答复 ${answered.length} 条，仍待答 ${stillOpen.length} 条${inbound.length ? `，对方反问 ${inbound.length} 条` : ''}。`

  const state = {
    ...target,
    machine_id: target.machine_id || machine,
    asks,
    facts: [...(Array.isArray(target.facts) ? target.facts : []), ...adopted],
    next_steps: [
      // What someone else is now waiting on you for goes ahead of your own list —
      // the same ordering rule landing uses, for the same reason.
      ...inbound.map((ask) => `回答对方反问 ${ask.id}：${ask.what}（什么算答完：${ask.accept}）`),
      ...(Array.isArray(target.next_steps) ? target.next_steps : []),
    ],
    current_state: `${note}\n\n${target.current_state || ''}`,
  }

  return {
    state,
    report: {
      from: bagPassport.origin || {},
      lineage: bagPassport.lineage || {},
      answered,
      answered_count: answered.length,
      still_open: stillOpen.map((ask) => ask.id),
      inbound_asks: inbound.map((ask) => ask.id),
      overwritten: reopened,
      facts_adopted: adopted.length,
      // Their landing checks were about their machine, not ours. Reported, never adopted.
      ignored_landing_checks: normalizeLandingChecks(bagPassport.landing_checks).length,
    },
  }
}

/* ---------- minimal ZIP, so a bag is one file anyone can double-click ---------- */

function dosTime(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31)
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31)
  return { time, day }
}

export function writeZip(entries) {
  const { time, day } = dosTime()
  const locals = []
  const central = []
  let offset = 0

  for (const [name, raw] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(raw)
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x0800, 8)
    entry.writeUInt16LE(useDeflate ? 8 : 0, 10)
    entry.writeUInt16LE(time, 12)
    entry.writeUInt16LE(day, 14)
    entry.writeUInt32LE(crc, 16)
    entry.writeUInt32LE(body.length, 20)
    entry.writeUInt32LE(raw.length, 24)
    entry.writeUInt16LE(nameBuf.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.size, 8)
  end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBuf, end])
}

export function readZip(buffer) {
  const entries = new Map()
  let position = buffer.length - 22
  while (position >= 0 && buffer.readUInt32LE(position) !== 0x06054b50) position -= 1
  if (position < 0) throw new Error('not a zip file (no end-of-central-directory record)')

  const count = buffer.readUInt16LE(position + 10)
  let cursor = buffer.readUInt32LE(position + 16)
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('corrupt zip central directory')
    const method = buffer.readUInt16LE(cursor + 10)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const body = buffer.subarray(start, start + compressedSize)
    entries.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body))

    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

let crcTable = null
function crc32(buffer) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
      crcTable[index] = value
    }
  }
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) crc = (crc >>> 8) ^ crcTable[(crc ^ buffer[index]) & 0xff]
  return (crc ^ -1) >>> 0
}

/**
 * Read luggage from disk. A directory is walked and its shape is kept, because "pack
 * the whole 资料 folder" is what people actually ask for, and a folder flattened into
 * a pile of files has lost the one thing that made it a folder.
 */
export async function readLuggage(paths = []) {
  const files = []
  const walk = async (absolute, relative) => {
    const info = await stat(absolute)
    if (info.isFile()) {
      files.push({ name: relative, data: await readFile(absolute) })
      return
    }
    if (!info.isDirectory()) return
    for (const entry of (await readdir(absolute)).sort()) {
      await walk(join(absolute, entry), `${relative}/${entry}`)
    }
  }
  for (const path of paths) {
    const clean = String(path).replace(/[\/]+$/, '')
    await walk(clean, basename(clean))
  }
  return files
}

/**
 * Write luggage back to disk. A bag whose files stay sealed inside the zip is just a
 * heavier way to send a note — the point is that they arrive usable.
 *
 * One implementation, called by every landing path there is: a handoff and a receipt
 * must unpack identically, and the path traversal guard that `luggagePath` applied on
 * the way in is only worth anything if nobody writes their own loop on the way out.
 */
export async function writeLuggage(entries, directory) {
  const landed = []
  for (const [path, data] of entries) {
    if (!path.startsWith('data/files/')) continue
    const target = join(directory, ...path.slice('data/files/'.length).split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    landed.push(target)
  }
  return landed
}
