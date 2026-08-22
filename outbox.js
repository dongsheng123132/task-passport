/**
 * The outbound ledger — what left, when, to whom, and exactly what was inside it.
 *
 * A pack is irreversible. Once it is in someone's chat app it is in their backups, their
 * model's context and possibly their vendor's logs; there is no unsend. Every mature
 * system that lets data out therefore keeps a record on the way out rather than a
 * retraction mechanism afterwards — GitHub's answer to a pushed secret is "rotate it",
 * not "delete it", because deletion cannot be relied on.
 *
 * So this file exists to answer one question that was previously unanswerable:
 *
 *   「上周发给客户的那个包里到底有什么？」
 *
 * A count is not enough to answer it, because the passport moves on: version 5 is gone
 * once you are at version 9. The ledger therefore archives the exact passport object
 * that left — post-sealing, the same bytes the receiver read — next to the line that
 * records it. That copy is small (tens of KB) and it is the only thing that can settle
 * the question honestly later.
 *
 * What this is NOT: it is not tamper-proof. Anyone who can write the store can rewrite
 * the ledger. It answers "what did I send" for someone acting in good faith and trying
 * to remember; it does not prove anything to a third party. Proving requires signatures,
 * which 0.1 does not have. Said plainly here so nobody mistakes a diary for a notary.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { withFileLock } from './store.js'

export const LEDGER_FILE = 'outbox.jsonl'
export const ARCHIVE_DIR = 'outbox'

/**
 * Where the ledger lives. It follows the store, because a ledger that drifts away from
 * the passports it describes is worse than none — you would trust it and it would be
 * describing someone else's work.
 */
export function outboxDirectory({ outbox, store } = {}) {
  if (outbox) return resolve(outbox)
  if (store) return resolve(store)
  // No store means the U-King provider (or another host) owns the state. The ledger is
  // ours either way, so it falls back to a fixed place rather than silently not existing.
  return resolve(join(homedir(), '.task-passport'))
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

/**
 * Filesystem-safe stamp: id, version, moment — and the pack's own digest.
 *
 * The digest is not decoration. Packing the same version twice within one second is
 * ordinary (the two encodings are written back to back), and without it both stubs
 * claim the same filename and the second silently overwrites the first — leaving a
 * ledger with two lines pointing at one copy. Found by the first smoke test.
 */
function archiveName(passportId, version, at, digest) {
  const id = String(passportId).replace(/[^\w-]/g, '_')
  const stamp = String(at).replace(/[:.]/g, '')
  return `${id}@${Number(version) || 0}-${stamp}${digest ? `-${String(digest).slice(0, 8)}` : ''}.json`
}

/**
 * Record one outbound pack. Never throws into the caller's critical path: the pack is
 * the deliverable, and failing to write a diary entry must not stop it from being
 * produced. Failures come back as a value so the caller can say so out loud.
 */
export async function recordOutbound(directory, { entry, passport, packBytes }) {
  const at = entry.at || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const state = passport?.passport || {}
  const line = {
    at,
    passport_id: entry.passport_id,
    state_version: entry.state_version ?? null,
    kind: passport?.kind || entry.kind || 'handoff',
    encoding: entry.encoding,
    to: entry.to || null,
    actor: passport?.origin?.actor || entry.actor || null,
    out: entry.out,
    pack_sha256: packBytes ? sha256(packBytes) : null,
    bytes: packBytes ? packBytes.length : null,
    note: passport?.note || entry.note || '',
    // Counts answer "how much left" at a glance; the archive answers "which ones".
    contents: {
      facts: (state.facts || []).length,
      decisions: (state.decisions || []).length,
      learnings: (state.learnings || []).length,
      next_steps: (state.next_steps || []).length,
      asks: (passport?.asks || []).length,
      landing_checks: (passport?.landing_checks || []).length,
      luggage: (entry.luggage || []).length,
    },
    luggage: entry.luggage || [],
    archived_passport: null,
  }

  try {
    await mkdir(join(directory, ARCHIVE_DIR), { recursive: true })
    if (passport) {
      const name = archiveName(entry.passport_id, entry.state_version, at, line.pack_sha256)
      await writeFile(join(directory, ARCHIVE_DIR, name), `${JSON.stringify(passport, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      line.archived_passport = `${ARCHIVE_DIR}/${name}`
    }
    const path = join(directory, LEDGER_FILE)
    // Two terminals packing at once is normal in this project, and a half-written line
    // makes the whole ledger unparseable from that point on. Same lock as the store.
    await withFileLock(`${path}.lock`, () => appendFile(path, `${JSON.stringify(line)}\n`, 'utf8'))
    return { ok: true, ledger: path, entry: line }
  } catch (error) {
    return { ok: false, error: error.message, entry: line }
  }
}

/** Read the ledger back. Unparseable lines are reported, not skipped in silence. */
export async function readOutbox(directory, { passportId, limit } = {}) {
  let raw = ''
  try {
    raw = await readFile(join(directory, LEDGER_FILE), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ledger: join(directory, LEDGER_FILE), count: 0, entries: [], damaged: 0 }
    throw error
  }
  const entries = []
  let damaged = 0
  for (const text of raw.split('\n')) {
    if (!text.trim()) continue
    try {
      entries.push(JSON.parse(text))
    } catch {
      damaged += 1
    }
  }
  const filtered = passportId ? entries.filter((item) => item.passport_id === passportId) : entries
  const limited = Number.isInteger(limit) && limit > 0 ? filtered.slice(-limit) : filtered
  return { ledger: join(directory, LEDGER_FILE), count: filtered.length, entries: limited, damaged }
}

/**
 * Open one archived passport by the path recorded in its ledger line — the answer to
 * "what exactly was in that pack", read from the bytes that actually left.
 */
export async function readArchived(directory, archivedPath) {
  const name = String(archivedPath || '').split('/').pop()
  if (!name || !/^[\w@.-]+\.json$/.test(name)) throw new Error(`not an archive name: ${archivedPath}`)
  return JSON.parse(await readFile(join(directory, ARCHIVE_DIR, name), 'utf8'))
}

/** List archives on disk, for when a ledger line is missing but the copy survived. */
export async function listArchives(directory) {
  try {
    return (await readdir(join(directory, ARCHIVE_DIR))).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}
