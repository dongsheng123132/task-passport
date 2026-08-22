import assert from 'node:assert/strict'
import test from 'node:test'
import { createPassportClient, generatePassportId, handoffPrompt, runUkingAction } from '../core.js'

test('passport ids are short, opaque and human-readable', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generatePassportId()))
  assert.equal(ids.size, 100)
  for (const id of ids) assert.match(id, /^TP-[23456789A-HJ-KM-NP-Z]{4}-[23456789A-HJ-KM-NP-Z]{4}$/)
})

test('list exposes passport vocabulary without leaking action implementation', async () => {
  const calls = []
  const client = createPassportClient({
    actionRunner: async (...args) => {
      calls.push(args)
      return { tasks: [{ id: 'TP-7K4M-9D2Q', title: '发布插件', goal: '今晚发布', current_state: '已验证', version: 3, updated_at: '2026-08-13T00:00:00Z', harness: 'claude-code' }] }
    },
  })
  const result = await client.list()
  assert.deepEqual(result, {
    count: 1,
    passports: [{
      passport_id: 'TP-7K4M-9D2Q', title: '发布插件', goal: '今晚发布', current_state: '已验证',
      state_version: 3, updated_at: '2026-08-13T00:00:00Z', last_harness: 'claude-code',
    }],
  })
  assert.equal(calls[0][0], 'runtime.origin.inspect')
})

test('open is exact and renders handoff context locally, never from the provider', async () => {
  const client = createPassportClient({
    actionRunner: async (_action, input) => ({
      tasks: input.task_id === 'TP-7K4M-9D2Q'
        ? [{
            id: input.task_id,
            version: 4,
            goal: 'g',
            current_state: 's',
            facts: [{ claim: '这条只在原机成立', verified: true, needs_reverify: true }],
            // A provider may ship prose of its own. It must not become what the model
            // reads: the unverified-fact warning has to be applied by this side.
            compiled_context: 'bounded context',
          }]
        : [],
    }),
  })
  const opened = await client.open('TP-7K4M-9D2Q')
  assert.notEqual(opened.compiled_context, 'bounded context', 'provider prose must not win')
  assert.match(opened.compiled_context, /TP-7K4M-9D2Q/)
  assert.match(opened.compiled_context, /⚠️ 这条只在原机成立/, 'the local renderer must flag it')
  assert.equal(opened.state.compiled_context, undefined)
  assert.match(opened.handoff_prompt, /TP-7K4M-9D2Q/)
  await assert.rejects(() => client.open('TP-NOT-FOUND'), /not found/)
  await assert.rejects(() => client.open('../TP-7K4M-9D2Q'), /unsupported characters/)
})

test('checkpoint carries optimistic version and records the receiving harness', async () => {
  let captured
  const client = createPassportClient({
    harness: 'deepseek-harness',
    actionRunner: async (action, input, options) => {
      captured = { action, input, options }
      return { state: { ...input.state, version: 6 } }
    },
  })
  const result = await client.checkpoint({ id: 'TP-7K4M-9D2Q', version: 5 }, 5)
  assert.equal(captured.action, 'runtime.origin.save')
  assert.equal(captured.input.expected_version, 5)
  assert.equal(captured.input.state.harness, 'deepseek-harness')
  assert.equal(captured.options.write, true)
  assert.equal(result.state_version, 6)
})

test('new creates one objective passport, not a harness session id', async () => {
  const calls = []
  const client = createPassportClient({
    harness: 'deepseek-harness',
    actionRunner: async (action, input) => {
      calls.push({ action, input })
      if (action === 'runtime.origin.inspect') return { tasks: [] }
      return { state: { ...input.state, version: 2 } }
    },
  })
  const created = await client.create({ title: '插件发布', goal: '发布 DSH 插件' })
  assert.match(created.passport_id, /^TP-/)
  assert.equal(calls[1].input.expected_version, 0)
  assert.equal(calls[1].input.state.kind, 'task.origin')
  assert.equal(calls[1].input.state.next_steps.length, 1)
})

test('handoff prompt says what transfers and what does not', () => {
  const prompt = handoffPrompt('TP-7K4M-9D2Q')
  assert.match(prompt, /已验证事实/)
  assert.match(prompt, /不继承.*聊天记录/)
})

test('a machine without U-King is pointed at the standalone store, not at installing U-King', async () => {
  // Field problem, 2026-08-16: someone running only Codex or DSH has no U-King and
  // does not want one. The old message read "Set TASK_PASSPORT_UKING to U-King.exe",
  // which tells them to install a product they never asked for. The standalone
  // store is the answer for them, so it must come first.
  // Hermetic: this box HAS U-King, and the win32 branch always appends the
  // LOCALAPPDATA candidates, so the absence must be staged rather than assumed.
  const saved = {
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    TASK_PASSPORT_UKING: process.env.TASK_PASSPORT_UKING,
    UKING_EXECUTABLE: process.env.UKING_EXECUTABLE,
  }
  for (const key of Object.keys(saved)) delete process.env[key]
  try {
    await assert.rejects(
      () => runUkingAction('runtime.origin.inspect', {}, { ukingExecutable: '/definitely/not/here.exe' }),
      (error) => {
        assert.match(error.message, /--store/, 'must offer the standalone store')
        assert.match(error.message, /TASK_PASSPORT_STORE/, 'must name the env var too')
        assert.ok(
          error.message.indexOf('--store') < error.message.indexOf('TASK_PASSPORT_UKING'),
          'the no-U-King path must be listed before the U-King path',
        )
        return true
      },
    )
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
