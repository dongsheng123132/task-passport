import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

// Regression: 0.3.1 shipped without outbox.js even though cli.js and mcp.js import
// it at the top. `npx task-passport@0.3.1 --help` died with ERR_MODULE_NOT_FOUND.
// package.json looked complete and the release workflow's tarball guard only named
// six files, so nothing failed until a user ran it.
test('the published file list covers every local module the entry points import', async () => {
  const { files } = JSON.parse(await read('../package.json'))
  const shipped = new Set(files)
  const entries = ['cli.js', 'mcp.js', 'index.js']
  const missing = []
  for (const entry of entries) {
    const source = await read(`../${entry}`)
    for (const match of source.matchAll(/from '\.\/([^']+)'/g)) {
      if (!shipped.has(match[1])) missing.push(`${entry} imports ${match[1]}`)
    }
  }
  assert.deepEqual(missing, [], `package.json "files" must ship every local import: ${missing.join(', ')}`)
})

// Regression: README told people to install @0.3.2 while the registry's latest was
// 0.3.1, so the documented command could not resolve. The version being published is
// the version every install command must name.
test('README install commands pin the version being published', async () => {
  const { version } = JSON.parse(await read('../package.json'))
  const readme = await read('../README.md')
  // Blockquotes are allowed to quote the old command that failed on a given network
  // (that record is the point); install commands outside them must name the version
  // being published.
  const commands = readme
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
  const pins = [...commands.matchAll(/task-passport@(\d+\.\d+\.\d+)/g)].map((match) => match[1])
  assert.ok(pins.length > 0, 'README must contain at least one install command')
  for (const pin of pins) {
    assert.equal(pin, version, `README pins task-passport@${pin}, package.json is ${version}`)
  }
})
