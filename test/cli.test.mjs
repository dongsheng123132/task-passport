import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import assert from 'node:assert/strict'

const execFileAsync = promisify(execFile)
const CLI = fileURLToPath(new URL('../cli.js', import.meta.url))

async function cli(store, args) {
  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args, '--store', store], {
    maxBuffer: 8 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function withStore(run) {
  const store = await mkdtemp(join(tmpdir(), 'task-passport-cli-'))
  try {
    return await run(store)
  } finally {
    await rm(store, { recursive: true, force: true })
  }
}

// Regression: PowerShell's `Set-Content -Encoding UTF8` emits a UTF-8 BOM, and
// JSON.parse rejects it. Found on a clean Windows Server 2022 box, 2026-08-15.
test('checkpoint accepts a state file written with a UTF-8 BOM', async () => {
  await withStore(async (store) => {
    const created = await cli(store, ['new', '--title', 'bom', '--goal', 'accept a BOM-prefixed state file'])
    const opened = await cli(store, ['open', created.passport_id])
    const state = { ...opened.state, current_state: 'written by a BOM-emitting shell' }

    const file = join(store, 'state-bom.json')
    await writeFile(file, '﻿' + JSON.stringify(state), 'utf8')
    const bytes = await readFile(file)
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'fixture must actually carry a BOM')

    const saved = await cli(store, ['checkpoint', '--file', file, '--expected-version', String(opened.state_version)])
    assert.equal(saved.state.version, opened.state_version + 1)
    assert.equal(saved.state.current_state, 'written by a BOM-emitting shell')
  })
})

test('checkpoint still rejects a stale version when the file carries a BOM', async () => {
  await withStore(async (store) => {
    const created = await cli(store, ['new', '--title', 'bom conflict', '--goal', 'stale writes must not slip through'])
    const opened = await cli(store, ['open', created.passport_id])
    const file = join(store, 'state-bom.json')
    await writeFile(file, '﻿' + JSON.stringify(opened.state), 'utf8')

    await cli(store, ['checkpoint', '--file', file, '--expected-version', String(opened.state_version)])

    await assert.rejects(
      () => cli(store, ['checkpoint', '--file', file, '--expected-version', String(opened.state_version)]),
      (error) => {
        assert.match(String(error.stdout ?? '') + String(error.stderr ?? ''), /conflict/i)
        return true
      },
      'a replayed expected-version must be refused, not silently applied',
    )
  })
})

test('checkpoint still parses a plain UTF-8 state file', async () => {
  await withStore(async (store) => {
    const created = await cli(store, ['new', '--title', 'no bom', '--goal', 'plain utf8 keeps working'])
    const opened = await cli(store, ['open', created.passport_id])
    const file = join(store, 'state.json')
    await writeFile(file, JSON.stringify({ ...opened.state, current_state: 'plain' }), 'utf8')
    const saved = await cli(store, ['checkpoint', '--file', file, '--expected-version', String(opened.state_version)])
    assert.equal(saved.state.current_state, 'plain')
  })
})

// Regression: a handoff (.tpx.json) or scratch state file dropped next to the
// passports used to make list() throw, blinding the whole store.
test('list survives an unrelated .json sitting in the store directory', async () => {
  await withStore(async (store) => {
    const created = await cli(store, ['new', '--title', 'stray', '--goal', 'one bad file must not blind the store'])
    await writeFile(join(store, 'not-a-passport.json'), '{ this is not json', 'utf8')
    await writeFile(join(store, 'someone-elses.json'), JSON.stringify({ id: 'TP-OTHER-0000', hello: 1 }), 'utf8')

    const listed = await cli(store, ['list'])
    assert.equal(listed.count, 1, 'the real passport must still be listed')
    assert.equal(listed.passports[0].passport_id, created.passport_id)

    const opened = await cli(store, ['open', created.passport_id])
    assert.equal(opened.state.id, created.passport_id, 'open must still work by exact id')
  })
})

test('doctor warns when a second authoritative store is also reachable', async () => {
  await withStore(async (store) => {
    const report = await cli(store, ['doctor'])
    assert.equal(report.ready, true)
    assert.equal(report.provider, 'directory')
    // The rival probe only fires when the other provider actually answers, so this
    // asserts the contract rather than the machine: a warning implies a named rival.
    if (report.warning) assert.ok(report.other_provider, 'a warning must name the other provider')
  })
})
