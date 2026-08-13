import assert from 'node:assert/strict'
import test from 'node:test'
import { createMcpRequestHandler, passportTools } from '../mcp.js'

function request(method, params) {
  return { jsonrpc: '2.0', id: 1, method, params }
}

test('MCP exposes the same four passport actions to any harness', async () => {
  const handle = createMcpRequestHandler({
    client: {
      list: async () => ({ count: 0, passports: [] }),
      open: async (id) => ({ passport_id: id, state_version: 2 }),
      create: async ({ title }) => ({ passport_id: 'TP-NEW1-0001', title }),
      checkpoint: async (_state, version) => ({ passport_id: 'TP-ONE1-0001', state_version: version + 1 }),
    },
  })

  const listed = await handle(request('tools/list'))
  assert.deepEqual(listed.tools.map((tool) => tool.name), passportTools.map((tool) => tool.name))

  const opened = await handle(request('tools/call', {
    name: 'task_passport_open',
    arguments: { passport_id: 'TP-ONE1-0001' },
  }))
  assert.equal(opened.structuredContent.passport_id, 'TP-ONE1-0001')

  const saved = await handle(request('tools/call', {
    name: 'task_passport_checkpoint',
    arguments: { state: { id: 'TP-ONE1-0001' }, expected_version: 2 },
  }))
  assert.equal(saved.structuredContent.state_version, 3)
})

test('MCP negotiates initialization and returns tool errors without killing the server', async () => {
  const handle = createMcpRequestHandler({
    client: {
      list: async () => { throw new Error('offline') },
    },
  })
  const initialized = await handle(request('initialize', { protocolVersion: '2025-06-18' }))
  assert.equal(initialized.protocolVersion, '2025-06-18')
  assert.equal(initialized.serverInfo.name, 'task-passport')

  const failed = await handle(request('tools/call', {
    name: 'task_passport_list', arguments: {},
  }))
  assert.equal(failed.isError, true)
  assert.match(failed.content[0].text, /offline/)
})

