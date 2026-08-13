import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compilePassportContext, createPassportClient } from '../core.js'
import { createDirectoryPassportProvider } from '../store.js'

async function temporaryStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'task-passport-store-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('directory provider works without U-King and leaves one durable state file', async (t) => {
  const directory = await temporaryStore(t)
  const provider = createDirectoryPassportProvider({ directory })
  const client = createPassportClient({ provider, harness: 'workbuddy' })

  assert.deepEqual(await client.list(), { count: 0, passports: [] })
  const created = await client.create({
    title: '发布插件',
    goal: '让任务跨 Harness 接力',
    nextStep: '先验证本地存储',
  })
  assert.equal(created.state_version, 1)
  assert.equal(created.state.harness, 'workbuddy')

  const opened = await client.open(created.passport_id)
  assert.match(opened.compiled_context, /让任务跨 Harness 接力/)
  const next = structuredClone(opened.state)
  next.current_state = '本地存储已验证'
  const saved = await client.checkpoint(next, opened.state_version)
  assert.equal(saved.state_version, 2)
  assert.equal((await client.list()).passports[0].current_state, '本地存储已验证')

  await assert.rejects(() => client.checkpoint(next, opened.state_version), /conflict/)
  assert.deepEqual(await readdir(directory), [`${created.passport_id}.json`])
})

test('two directory providers reject one stale concurrent checkpoint', async (t) => {
  const directory = await temporaryStore(t)
  const first = createPassportClient({
    provider: createDirectoryPassportProvider({ directory }),
    harness: 'claude-code',
  })
  const created = await first.create({ title: '并发交接', goal: '不覆盖新状态' })
  const second = createPassportClient({
    provider: createDirectoryPassportProvider({ directory }),
    harness: 'deepseek-harness',
  })

  const [left, right] = await Promise.all([
    first.open(created.passport_id),
    second.open(created.passport_id),
  ])
  left.state.current_state = 'Claude 完成'
  right.state.current_state = 'DSH 完成'

  const results = await Promise.allSettled([
    first.checkpoint(left.state, left.state_version),
    second.checkpoint(right.state, right.state_version),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /conflict/)
  assert.equal((await first.open(created.passport_id)).state_version, 2)
})

test('compiled context includes verified facts but not unverified claims', () => {
  const context = compilePassportContext({
    id: 'TP-7K4M-9D2Q',
    goal: '交接长文',
    current_state: '已完成三章',
    facts: [
      { claim: '第三章已校对', source: 'chapter-3.md#sha256', verified: true },
      { claim: '读者一定喜欢', verified: false },
    ],
    decisions: [],
    artifacts: ['chapter-3.md#sha256'],
    next_steps: ['继续第四章'],
  })
  assert.match(context, /第三章已校对/)
  assert.doesNotMatch(context, /读者一定喜欢/)
  assert.match(context, /chapter-3\.md#sha256/)
})

test('directory provider never steals a stale-looking lock from a live process', async (t) => {
  const directory = await temporaryStore(t)
  await mkdir(directory, { recursive: true })
  const id = 'TP-LOCK-LIVE'
  const lockPath = join(directory, `${id}.json.lock`)
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, created_at: '2000-01-01T00:00:00Z' }))
  const provider = createDirectoryPassportProvider({
    directory,
    lockTimeoutMs: 40,
    retryDelayMs: 5,
    staleLockMs: 0,
  })
  await assert.rejects(
    () => provider.save({ id, version: 1 }, 0),
    /store is busy/,
  )
})

test('directory provider recovers a stale lock after its owner process is gone', async (t) => {
  const directory = await temporaryStore(t)
  await mkdir(directory, { recursive: true })
  const id = 'TP-LOCK-DEAD'
  await writeFile(
    join(directory, `${id}.json.lock`),
    JSON.stringify({ pid: 2_147_483_647, created_at: '2000-01-01T00:00:00Z' }),
  )
  const provider = createDirectoryPassportProvider({ directory, staleLockMs: 0 })
  const saved = await provider.save({ id, version: 1 }, 0)
  assert.equal(saved.version, 1)
  assert.deepEqual(await readdir(directory), [`${id}.json`])
})
