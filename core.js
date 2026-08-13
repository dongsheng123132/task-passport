import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access, rm, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PASSPORT_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

function executableCandidates(explicit) {
  const candidates = [
    explicit,
    process.env.TASK_PASSPORT_UKING,
    process.env.UKING_EXECUTABLE,
  ]

  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    if (local) {
      candidates.push(
        join(local, 'U-King', 'U-King.exe'),
        join(local, 'Programs', 'U-King', 'U-King.exe'),
      )
    }
    candidates.push('U-King.exe', 'u-king-mini.exe')
  } else {
    candidates.push('/Applications/U-King.app/Contents/MacOS/u-king-mini', 'u-king-mini')
  }

  return [...new Set(candidates.filter((value) => typeof value === 'string' && value.trim()))]
}

function parseActionOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) throw new Error('U-King returned an empty response')
  try {
    return JSON.parse(text)
  } catch {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index])
      } catch {
        // Keep looking. A development shell can print a banner before the JSON contract.
      }
    }
    throw new Error(`U-King returned non-JSON output: ${text.slice(0, 300)}`)
  }
}

async function canAccess(path) {
  if (!/[\\/]/.test(path)) return true
  try {
    await access(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function runUkingAction(actionId, input = {}, options = {}) {
  const candidates = executableCandidates(options.ukingExecutable)
  const hasInput = input && Object.keys(input).length > 0
  const inputFile = hasInput
    ? join(tmpdir(), `task-passport-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.json`)
    : null

  if (inputFile) await writeFile(inputFile, JSON.stringify(input), { encoding: 'utf8', mode: 0o600 })

  let missingError = null
  try {
    for (const executable of candidates) {
      if (!(await canAccess(executable))) continue
      const args = ['action', 'run', actionId, '--json']
      if (inputFile) args.push('--input-file', inputFile)
      else args.push('--no-input')
      try {
        const { stdout } = await execFileAsync(executable, args, {
          windowsHide: true,
          timeout: options.timeoutMs ?? 10_000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, ...(options.env ?? {}) },
        })
        return parseActionOutput(stdout)
      } catch (error) {
        if (error?.code === 'ENOENT') {
          missingError = error
          continue
        }
        const stderr = String(error?.stderr ?? '').trim()
        const stdout = String(error?.stdout ?? '').trim()
        throw new Error(stderr || stdout || error?.message || `U-King action ${actionId} failed`)
      }
    }
  } finally {
    if (inputFile) await rm(inputFile, { force: true }).catch(() => {})
  }

  const hint = candidates.filter((item) => /[\\/]/.test(item)).join(', ')
  throw new Error(
    `U-King executable was not found. Set TASK_PASSPORT_UKING to U-King.exe${hint ? ` (checked: ${hint})` : ''}.` +
      (missingError ? ` ${missingError.message}` : ''),
  )
}

function summary(state) {
  return {
    passport_id: state.id,
    title: state.title || state.id,
    goal: state.goal || '',
    current_state: state.current_state || '',
    state_version: Number(state.version || 0),
    updated_at: state.updated_at || '',
    last_harness: state.harness || '',
  }
}

function exactPassportId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) throw new Error('passport_id is required')
  if (value.length > 120 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('passport_id contains unsupported characters')
  }
  return value
}

export function handoffPrompt(passportId) {
  return `请接手任务护照 ${passportId}：先读取当前状态与下一步，只继承已验证事实，不继承上一位 AI 的聊天记录。`
}

export function generatePassportId() {
  const bytes = randomBytes(8)
  let body = ''
  for (let index = 0; body.length < 8; index += 1) {
    body += PASSPORT_ALPHABET[bytes[index] % PASSPORT_ALPHABET.length]
  }
  return `TP-${body.slice(0, 4)}-${body.slice(4, 8)}`
}

export function createPassportClient(options = {}) {
  const actionRunner = options.actionRunner ?? ((actionId, input, actionOptions) =>
    runUkingAction(actionId, input, { ...options, ...actionOptions }))

  async function list() {
    const result = await actionRunner('runtime.origin.inspect', {}, { write: false })
    const states = Array.isArray(result?.tasks) ? result.tasks : []
    return { count: states.length, passports: states.map(summary) }
  }

  async function open(passportId) {
    const exactId = exactPassportId(passportId)
    const result = await actionRunner(
      'runtime.origin.inspect',
      { task_id: exactId, compiled: true },
      { write: false },
    )
    const state = Array.isArray(result?.tasks) ? result.tasks[0] : null
    if (!state) throw new Error(`Task passport ${exactId} was not found`)
    const { compiled_context: compiledContext = '', ...rawState } = state
    return {
      passport_id: rawState.id,
      state_version: Number(rawState.version || 0),
      state: rawState,
      compiled_context: compiledContext,
      handoff_prompt: handoffPrompt(rawState.id),
    }
  }

  async function checkpoint(state, expectedVersion) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('state must be the object returned by task_passport_open')
    }
    exactPassportId(state.id)
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error('expected_version must be a non-negative integer')
    }
    const next = { ...state, harness: options.harness ?? 'task-passport' }
    const result = await actionRunner(
      'runtime.origin.save',
      { state: next, expected_version: expectedVersion },
      { write: true },
    )
    const saved = result?.state
    if (!saved) throw new Error('U-King did not return the saved task state')
    return {
      passport_id: saved.id,
      state_version: Number(saved.version || 0),
      state: saved,
      handoff_prompt: handoffPrompt(saved.id),
    }
  }

  async function create({ title, goal, currentState, nextStep } = {}) {
    if (!title?.trim()) throw new Error('title is required')
    if (!goal?.trim()) throw new Error('goal is required')

    const existing = new Set((await list()).passports.map((item) => item.passport_id))
    let id = generatePassportId()
    while (existing.has(id)) id = generatePassportId()
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const state = {
      spec: '2origin/0.1',
      kind: 'task.origin',
      id,
      title: title.trim(),
      goal: goal.trim(),
      version: 1,
      machine_id: '',
      harness: options.harness ?? 'task-passport',
      scope: '',
      created_at: now,
      updated_at: now,
      current_state: currentState?.trim() || '任务护照已创建，尚未开始执行。',
      facts: [],
      decisions: [],
      actions: [],
      artifacts: [],
      verification: '',
      next_steps: [nextStep?.trim() || '读取目标，制定并执行第一个可验证步骤。'],
      learnings: [],
    }
    return await checkpoint(state, 0)
  }

  return { list, open, checkpoint, create }
}

export function defaultUkingHints() {
  return executableCandidates('').map((path) => ({ path, label: basename(path), home: homedir() }))
}
