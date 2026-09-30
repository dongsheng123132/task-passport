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

// Regression: 0.3.1 went to npm with the CLI and the MCP server still reporting 0.3.0,
// because a release bumped package.json and nothing else. Every place that states the
// version has to state the one being published.
test('every declared version matches package.json', async () => {
  const { version } = await readJson('../package.json')
  const source = async (path) => readFile(new URL(path, import.meta.url), 'utf8')
  const marketplace = await readJson('../.codebuddy-plugin/marketplace.json')

  assert.match(await source('../cli.js'), new RegExp(`^const VERSION = '${version}'$`, 'm'), 'cli.js VERSION')
  assert.match(await source('../mcp.js'), new RegExp(`^const SERVER_VERSION = '${version}'$`, 'm'), 'mcp.js SERVER_VERSION')
  assert.equal((await readJson('../.workbuddy-plugin/plugin.json')).version, version, 'WorkBuddy plugin')
  assert.equal(marketplace.version, version, 'marketplace')
  assert.equal(marketplace.plugins.find((plugin) => plugin.name === 'task-passport').version, version, 'marketplace entry')
})
