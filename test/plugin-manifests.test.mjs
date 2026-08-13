import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'))
}

test('WorkBuddy plugin exposes the existing local MCP server', async () => {
  const plugin = await readJson('../.workbuddy-plugin/plugin.json')
  const mcp = await readJson('../.mcp.json')

  assert.equal(plugin.name, 'task-passport')
  assert.equal(mcp.mcpServers['task-passport'].command, 'node')
  assert.deepEqual(mcp.mcpServers['task-passport'].args, [
    '${CODEBUDDY_PLUGIN_ROOT}/cli.js',
    'mcp',
  ])
})

test('WorkBuddy marketplace points to the public Task Passport repository', async () => {
  const marketplace = await readJson('../.codebuddy-plugin/marketplace.json')
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'task-passport')

  assert.equal(marketplace.name, 'task-passport-marketplace')
  assert.equal(entry.source.source, 'github')
  assert.equal(entry.source.repo, 'dongsheng123132/task-passport')
})
