import assert from 'node:assert/strict'
import { createPassportClient } from '../core.js'

const executable = process.env.TASK_PASSPORT_UKING
const testHome = process.env.TASK_PASSPORT_TEST_HOME
if (!executable || !testHome) {
  throw new Error('TASK_PASSPORT_UKING and TASK_PASSPORT_TEST_HOME are required')
}

const client = createPassportClient({
  ukingExecutable: executable,
  harness: 'task-passport-e2e',
  env: { USERPROFILE: testHome, HOME: testHome },
})

const before = await client.list()
assert.equal(before.count, 0)

const created = await client.create({
  title: 'DeepSeek Harness 插件发布',
  goal: '验证任务能从 U-King 交接给 DeepSeek Harness',
  currentState: 'Task Passport 包已完成第一轮本地测试。',
  nextStep: '由 DeepSeek Harness 打开护照并写回验证结果。',
})
assert.match(created.passport_id, /^TP-/)

const opened = await client.open(created.passport_id)
assert.equal(opened.state.title, 'DeepSeek Harness 插件发布')
assert.match(opened.compiled_context, /由 DeepSeek Harness 打开护照/)

const next = {
  ...opened.state,
  current_state: 'U-King 创建、Task Passport 打开与写回均已通过真实 Action Core。',
  verification: '真实 u-king-mini.exe；隔离 USERPROFILE；读写后回读。',
  next_steps: ['把同一护照挂进 DeepSeek Harness 的真实工具管线。'],
}
const saved = await client.checkpoint(next, opened.state_version)
assert.equal(saved.state_version, opened.state_version + 1)

await assert.rejects(
  () => client.checkpoint(next, opened.state_version),
  /conflict/,
  'stale harness writes must be rejected',
)

const final = await client.open(created.passport_id)
assert.equal(final.state.current_state, next.current_state)
console.log(JSON.stringify({
  status: 'passed',
  passport_id: final.passport_id,
  state_version: final.state_version,
  title: final.state.title,
  stale_write_rejected: true,
}))
