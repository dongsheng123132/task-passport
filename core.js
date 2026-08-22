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
        join(local, 'u-king', 'u-king-mini.exe'),
        join(local, 'u-king', 'U-King.exe'),
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
  // Most people who land here never wanted U-King: they run Codex or DSH and just
  // need somewhere local to keep passports. Sending them off to install a product
  // they did not ask for is the wrong first instruction, so lead with the
  // standalone store and keep U-King as the second option.
  throw new Error(
    'No passport store is configured, and U-King was not found.\n' +
      '  Standalone (no U-King needed): pass --store <directory>, or set TASK_PASSPORT_STORE=<directory>.\n' +
      '  Using U-King: set TASK_PASSPORT_UKING to U-King.exe' +
      `${hint ? ` (checked: ${hint})` : ''}.` +
      (missingError ? `\n  ${missingError.message}` : ''),
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

function boundedText(value, limit = 700) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

// Truncation must announce itself. A silently capped list reads as "that was all
// of it", which is the one thing a handoff must never imply.
function lines(items, render, limit, newest = false) {
  const values = Array.isArray(items) ? items : []
  const kept = newest ? values.slice(-limit) : values.slice(0, limit)
  const rendered = kept.map(render).filter(Boolean)
  const hidden = values.length - kept.length
  if (hidden > 0) rendered.push(`- …另有 ${hidden} 条未显示（共 ${values.length} 条），需要时读护照原文`)
  return rendered
}

function factLine(mark) {
  return (fact) => {
    if (!fact || typeof fact !== 'object' || !fact.claim) return ''
    const notes = []
    if (fact.source) notes.push(`来源：${boundedText(String(fact.source), 300)}`)
    if (fact.verified_by) notes.push(`验证方：${boundedText(String(fact.verified_by), 80)}`)
    if (fact.verified_on) notes.push(`曾验证于：${boundedText(String(fact.verified_on), 80)}`)
    if (fact.scope) notes.push(`作用域：${boundedText(String(fact.scope), 40)}`)
    return `- ${mark} ${boundedText(fact.claim)}${notes.length ? `（${notes.join('；')}）` : ''}`
  }
}

export function compilePassportContext(state) {
  const allFacts = Array.isArray(state.facts) ? state.facts : []
  const proven = []
  const unproven = []
  for (const fact of allFacts) {
    if (!fact || typeof fact !== 'object') continue
    // An unproven fact is never dropped. Dropping it hides its existence from the
    // next model, which is worse than showing it flagged — it just never gets a ✓.
    if (fact.verified === true && fact.needs_reverify !== true) proven.push(fact)
    else unproven.push(fact)
  }

  const facts = lines(proven, factLine('✓'), 12, true)
  const pending = lines(unproven, factLine('⚠️'), 12, true)
  const decisions = lines(
    state.decisions,
    (decision) => `- ${boundedText(decision.what)}${decision.why ? ` — ${boundedText(decision.why, 400)}` : ''}`,
    8,
    true,
  )
  const artifacts = lines(state.artifacts, (artifact) => `- ${boundedText(artifact, 500)}`, 12, true)
  const nextSteps = lines(state.next_steps, (step) => `- ${boundedText(step)}`, 10)

  return [
    `## 任务护照 ${boundedText(state.id, 120)}`,
    '',
    `**目标**：${boundedText(state.goal) || '未记录'}`,
    `**当前状态**：${boundedText(state.current_state, 1_200) || '未记录'}`,
    '',
    '**已验证事实**：',
    ...(facts.length ? facts : ['- 暂无']),
    ...(pending.length
      ? ['', '**尚未验证 / 需在本机重验**（不要当作事实使用；先自己验证，或向发起方确认）：', ...pending]
      : []),
    '',
    '**已定决策**：',
    ...(decisions.length ? decisions : ['- 暂无']),
    '',
    '**产物引用**：',
    ...(artifacts.length ? artifacts : ['- 暂无']),
    '',
    '**下一步**：',
    ...(nextSteps.length ? nextSteps : ['- 暂无']),
  ].join('\n')
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

export function createUkingPassportProvider(options = {}) {
  const actionRunner = options.actionRunner ?? ((actionId, input, actionOptions) =>
    runUkingAction(actionId, input, { ...options, ...actionOptions }))

  return {
    kind: 'uking-action',
    async list() {
      const result = await actionRunner('runtime.origin.inspect', {}, { write: false })
      return Array.isArray(result?.tasks) ? result.tasks : []
    },
    async open(passportId) {
      const result = await actionRunner(
        'runtime.origin.inspect',
        { task_id: passportId, compiled: true },
        { write: false },
      )
      const state = Array.isArray(result?.tasks) ? result.tasks[0] : null
      if (!state) return null
      const { compiled_context: compiledContext = '', ...rawState } = state
      return { state: rawState, compiledContext }
    },
    async save(state, expectedVersion) {
      const result = await actionRunner(
        'runtime.origin.save',
        { state, expected_version: expectedVersion },
        { write: true },
      )
      if (!result?.state) throw new Error('U-King did not return the saved task state')
      return result.state
    },
  }
}

function assertProvider(provider) {
  for (const method of ['list', 'open', 'save']) {
    if (typeof provider?.[method] !== 'function') {
      throw new Error(`Task Passport provider must implement ${method}()`)
    }
  }
  return provider
}

export function createPassportClient(options = {}) {
  const provider = assertProvider(options.provider ?? createUkingPassportProvider(options))

  async function list() {
    const states = await provider.list()
    if (!Array.isArray(states)) throw new Error('Task Passport provider list() must return an array')
    return { count: states.length, passports: states.map(summary) }
  }

  async function open(passportId) {
    const exactId = exactPassportId(passportId)
    const record = await provider.open(exactId)
    const rawState = record?.state
    if (!rawState) throw new Error(`Task passport ${exactId} was not found`)
    if (rawState.id !== exactId) throw new Error(`Task Passport provider returned the wrong id for ${exactId}`)
    return {
      passport_id: rawState.id,
      state_version: Number(rawState.version || 0),
      state: rawState,
      // One renderer, always local. A provider may ship its own prose, but the
      // safety annotations (unverified facts, truncation notices) have to be applied
      // by the code that actually feeds the model — not by the far side.
      compiled_context: compilePassportContext(rawState),
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
    const saved = await provider.save(next, expectedVersion)
    if (!saved || typeof saved !== 'object') {
      throw new Error('Task Passport provider save() must return the saved state')
    }
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

  return { provider: provider.kind || 'custom', list, open, checkpoint, create }
}

export function defaultUkingHints() {
  return executableCandidates('').map((path) => ({ path, label: basename(path), home: homedir() }))
}
