import { randomBytes } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

function passportId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error('passport_id contains unsupported characters')
  }
  return id
}

function statePath(directory, id) {
  return resolve(directory, `${passportId(id)}.json`)
}

async function readState(path, expectedId) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid task passport state in ${path}`)
    }
    if (expectedId && parsed.id !== expectedId) {
      throw new Error(`Task passport id mismatch in ${path}`)
    }
    return parsed
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

async function retireStaleLock(lockPath, staleLockMs) {
  try {
    const info = await stat(lockPath)
    if (Date.now() - info.mtimeMs < staleLockMs) return false
    let lock = null
    try {
      lock = JSON.parse(await readFile(lockPath, 'utf8'))
    } catch {
      // A stale partial lock has no live owner proof and may be retired.
    }
    if (Number.isInteger(lock?.pid) && lock.pid > 0) {
      try {
        process.kill(lock.pid, 0)
        return false
      } catch (error) {
        if (error?.code !== 'ESRCH') return false
      }
    }
    const retired = `${lockPath}.stale-${process.pid}-${randomBytes(4).toString('hex')}`
    await rename(lockPath, retired)
    await rm(retired, { force: true })
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    return false
  }
}

async function acquireLock(lockPath, options) {
  const started = Date.now()
  while (true) {
    try {
      const handle = await open(lockPath, 'wx', 0o600)
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }))
        await handle.close()
      } catch (error) {
        await handle.close().catch(() => {})
        await rm(lockPath, { force: true }).catch(() => {})
        throw error
      }
      return
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      if (await retireStaleLock(lockPath, options.staleLockMs)) continue
      if (Date.now() - started >= options.lockTimeoutMs) {
        throw new Error(`Task passport store is busy: ${lockPath}`)
      }
      await delay(options.retryDelayMs)
    }
  }
}

async function withLock(lockPath, options, operation) {
  await acquireLock(lockPath, options)
  try {
    return await operation()
  } finally {
    await rm(lockPath, { force: true }).catch(() => {})
  }
}

/**
 * Reference local provider for Task Passport.
 *
 * Provider contract:
 * - list(): state[]
 * - open(passportId): { state, compiledContext? } | null
 * - save(state, expectedVersion): saved state
 */
export function createDirectoryPassportProvider(options = {}) {
  if (!options.directory || typeof options.directory !== 'string') {
    throw new Error('directory is required for the directory passport provider')
  }

  const directory = resolve(options.directory)
  const lockOptions = {
    lockTimeoutMs: options.lockTimeoutMs ?? 5_000,
    retryDelayMs: options.retryDelayMs ?? 25,
    staleLockMs: options.staleLockMs ?? 30_000,
  }

  async function list() {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }

    const states = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(0, -5)
      if (!/^[A-Za-z0-9_-]+$/.test(id)) continue
      states.push(await readState(statePath(directory, id), id))
    }
    return states.filter(Boolean).sort((left, right) =>
      String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
  }

  async function inspect(id) {
    const exactId = passportId(id)
    const state = await readState(statePath(directory, exactId), exactId)
    return state ? { state } : null
  }

  async function save(state, expectedVersion) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('state must be an object')
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error('expected_version must be a non-negative integer')
    }

    const id = passportId(state.id)
    await mkdir(directory, { recursive: true })
    const path = statePath(directory, id)
    const lockPath = `${path}.lock`

    return await withLock(lockPath, lockOptions, async () => {
      const existing = await readState(path, id)
      const currentVersion = Number(existing?.version || 0)
      if (currentVersion !== expectedVersion) {
        throw new Error(`conflict: expected task passport version ${expectedVersion}, found ${currentVersion}`)
      }

      const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
      const saved = {
        ...state,
        id,
        version: currentVersion + 1,
        created_at: existing?.created_at || state.created_at || now,
        updated_at: now,
      }
      const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`
      try {
        await writeFile(temporary, `${JSON.stringify(saved, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true }).catch(() => {})
      }
      return saved
    })
  }

  return { kind: 'directory', directory, list, open: inspect, save }
}
