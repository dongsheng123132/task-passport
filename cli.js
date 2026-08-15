#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { buildBag, readLuggage, readZip, unpackState, verifyBag, writeZip } from './bag.js'
import { createPassportClient, defaultUkingHints, handoffPrompt } from './core.js'
import { runMcpServer } from './mcp.js'
import { createDirectoryPassportProvider } from './store.js'
import { conformance, fromFlat, lintForExport, toFlat } from './taskpack.js'

const VERSION = '0.3.0'

/**
 * Read a TaskPack in either encoding. A zip starts with "PK"; anything else is
 * treated as the flat JSON form, which also covers the retired `.tpx` files that
 * are already sitting in people's chat histories.
 */
async function readPack(path) {
  const raw = await readFile(path)
  const isZip = raw.length > 1 && raw[0] === 0x50 && raw[1] === 0x4b
  return isZip ? readZip(raw) : fromFlat(raw.toString('utf8').replace(/^﻿/, ''))
}

/**
 * `--ask "什么|什么算答完"` — the pipe is the whole point: an ask you cannot state an
 * acceptance rule for is refused at pack time, so the shorthand makes you write one.
 */
function inlineAsks() {
  return options('--ask').map((raw, index) => {
    const [what, accept, why] = String(raw).split('|')
    return { id: `a${index + 1}`, what: (what || '').trim(), accept: (accept || '').trim(), why: (why || '').trim() }
  })
}

function inlineChecks() {
  return options('--check').map((raw, index) => {
    const [check, how] = String(raw).split('|')
    return { id: `c${index + 1}`, check: (check || '').trim(), how: (how || '').trim(), required: true }
  })
}

async function jsonOption(name) {
  const path = option(name)
  if (!path) return []
  const parsed = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''))
  return Array.isArray(parsed) ? parsed : []
}

const argv = process.argv.slice(2)

function option(name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function options(name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1])
  }
  return values
}

function requiredOption(name) {
  const value = option(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function usage() {
  return `Task Passport ${VERSION}  ·  TaskPack ${'taskpack/0.1'}

Usage:
  task-passport list [--uking <path> | --store <directory>]
  task-passport open <TP-ID> [--uking <path> | --store <directory>]
  task-passport prompt <TP-ID>
  task-passport new --title <text> --goal <text> [--current-state <text>] [--next-step <text>] [--store <directory>]
  task-passport checkpoint --file <state.json> --expected-version <n> [--store <directory>]
  task-passport pack <TP-ID> --out <file> [--flat] [--file <path>]... [--actor <name>] [--note <text>]
                              [--ask "要什么|什么算答完"]... [--check "要自检什么|怎么做"]...
                              [--asks <asks.json>] [--checks <checks.json>] [--kind receipt]
  task-passport unpack <file> [--store <directory>]          (别名: land) [--dry-run] [--files-out <dir>]
  task-passport conformance <file>
  task-passport doctor [--uking <path> | --store <directory>]
  task-passport mcp [--uking <path> | --store <directory>]

stdout is JSON except for the prompt command. Long state must go through --file.

TaskPack is the box a task travels in; the passport is the record that stays home.
pack writes .taskpack (ZIP + BagIt, RFC 8493) or, with --flat, .taskpack.json — one
readable file a colleague who installed nothing can hand to their own AI. Both
encodings carry the same model and conformance proves they round-trip.

land opens a pack into a NEW local passport, records the sender as lineage, and
refuses to let facts that only held on the sender's machine arrive wearing a ✓.
Moving a task to your other computer is the same command as handing it to a person.

(export/import remain as aliases for pack/land.)`
}

function storeDirectory() {
  return option('--store') || process.env.TASK_PASSPORT_STORE
}

function clientOptions(harness) {
  const directory = storeDirectory()
  return {
    ukingExecutable: option('--uking'),
    provider: directory ? createDirectoryPassportProvider({ directory }) : undefined,
    harness,
  }
}

async function main() {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    console.log(usage())
    return
  }
  if (command === '--version' || command === '-v') {
    console.log(VERSION)
    return
  }

  if (command === 'mcp') {
    await runMcpServer({
      ukingExecutable: option('--uking'),
      storeDirectory: storeDirectory(),
      harness: process.env.TASK_PASSPORT_HARNESS || 'mcp',
    })
    return
  }

  const client = createPassportClient(clientOptions(
    process.env.TASK_PASSPORT_HARNESS || 'task-passport-cli',
  ))

  if (command === 'list') {
    console.log(JSON.stringify(await client.list()))
    return
  }
  if (command === 'open') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('passport id is required')
    console.log(JSON.stringify(await client.open(argv[1])))
    return
  }
  if (command === 'prompt') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('passport id is required')
    console.log(handoffPrompt(argv[1]))
    return
  }
  if (command === 'new') {
    const result = await client.create({
      title: requiredOption('--title'),
      goal: requiredOption('--goal'),
      currentState: option('--current-state'),
      nextStep: option('--next-step'),
    })
    console.log(JSON.stringify(result))
    return
  }
  if (command === 'checkpoint') {
    // Windows PowerShell writes UTF-8 with a BOM by default; JSON.parse rejects it.
    const state = JSON.parse((await readFile(requiredOption('--file'), 'utf8')).replace(/^﻿/, ''))
    const expectedVersion = Number(requiredOption('--expected-version'))
    console.log(JSON.stringify(await client.checkpoint(state, expectedVersion)))
    return
  }
  if (command === 'pack' || command === 'export') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('passport id is required')
    const opened = await client.open(argv[1])
    const files = await readLuggage(options('--file'))
    const asks = [...inlineAsks(), ...(await jsonOption('--asks'))]
    const landingChecks = [...inlineChecks(), ...(await jsonOption('--checks'))]

    // Warnings go to stderr so stdout stays a parseable contract. They are warnings,
    // not refusals: only the sender knows whether the receiver already has that drive.
    for (const warning of lintForExport({ state: opened.state, files, asks })) {
      console.error(`⚠ ${warning}`)
    }

    const bag = buildBag({
      state: opened.state,
      files,
      actor: option('--actor') || '',
      machine: hostname(),
      note: option('--note') || '',
      kind: option('--kind') || 'handoff',
      asks,
      landingChecks,
    })
    const flat = argv.includes('--flat')
    const out = requiredOption('--out')
    await writeFile(out, flat ? Buffer.from(toFlat(bag), 'utf8') : writeZip(bag))
    console.log(JSON.stringify({
      ok: true,
      pack: out,
      encoding: flat ? 'flat' : 'bagit-zip',
      passport_id: opened.state.id,
      state_version: opened.state_version,
      entries: [...bag.keys()],
      asks: asks.length,
      landing_checks: landingChecks.length,
      luggage: options('--file').map((path) => basename(path)),
    }))
    return
  }

  if (command === 'conformance') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('pack path is required')
    const report = conformance(await readPack(argv[1]))
    console.log(JSON.stringify(report))
    // A suite that cannot fail proves nothing, so a failing pack must fail the process.
    if (!report.ok) process.exitCode = 2
    return
  }

  // 打包 / 解包 is the pair people say out loud; `land` stays the spec term and
  // `import` keeps the first users' muscle memory working.
  if (command === 'land' || command === 'unpack' || command === 'import') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('pack path is required')
    const entries = await readPack(argv[1])
    const { ok, errors, passport } = verifyBag(entries)
    if (!ok) {
      console.log(JSON.stringify({ ok: false, errors }))
      process.exitCode = 1
      return
    }
    const files = [...entries.keys()].filter((path) => path.startsWith('data/files/')).map((path) => path.slice('data/files/'.length))
    if (argv.includes('--dry-run')) {
      console.log(JSON.stringify({
        ok: true,
        dry_run: true,
        from: passport.origin,
        lineage: passport.lineage,
        title: passport.passport?.title,
        luggage: files,
      }))
      return
    }
    // A new local id, never the sender's: one task keeps exactly one authoritative store.
    const created = await client.create({
      title: passport.passport?.title || passport.lineage.root_id,
      goal: passport.passport?.goal || '',
    })
    const opened = await client.open(created.passport_id)

    // Unpack the luggage for real. A bag whose files stay sealed inside the zip is
    // just a heavier way to send a note — the point is that they arrive usable.
    const luggageDirectory = option('--files-out')
      || (storeDirectory() ? join(storeDirectory(), `${created.passport_id}.files`) : `${created.passport_id}.files`)
    const landed = []
    if (files.length) {
      await mkdir(luggageDirectory, { recursive: true })
      for (const [path, data] of entries) {
        if (!path.startsWith('data/files/')) continue
        const target = join(luggageDirectory, ...path.slice('data/files/'.length).split('/'))
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, data)
        landed.push(target)
      }
    }

    const state = unpackState(passport, {
      machine: hostname(),
      localId: created.passport_id,
      files: landed,
      trustMachineFacts: argv.includes('--trust-machine-facts'),
    })
    const saved = await client.checkpoint({ ...state, version: opened.state_version }, opened.state_version)
    const required = (state.landing_checks || []).filter((check) => check.required)
    console.log(JSON.stringify({
      ok: true,
      passport_id: created.passport_id,
      lineage: passport.lineage,
      from: passport.origin,
      luggage: landed,
      needs_reverify: (saved.state?.facts || []).filter((fact) => fact?.needs_reverify).length,
      // Landed is not the same as ready. These are the two reasons it is not yet ready,
      // reported as counts so a script can gate on them instead of reading prose.
      landing_checks_required: required.length,
      open_asks: (state.asks || []).filter((ask) => ask.status === 'open').length,
      handoff_prompt: handoffPrompt(created.passport_id),
    }))
    return
  }

  if (command === 'doctor') {
    try {
      const result = await client.list()
      const report = { ready: true, provider: client.provider, passport_count: result.count }
      // A task may only have one authoritative store. If the *other* provider is also
      // live on this machine, two harnesses can silently end up on two different copies.
      // Only one direction is meaningful: a directory store is explicit, so check
      // whether U-King would also answer here. With no --store there is no rival to probe.
      const other = storeDirectory()
        ? createPassportClient({ ukingExecutable: option('--uking'), harness: 'doctor-probe' })
        : null
      const rival = other
        ? await other.list().then((r) => ({ provider: other.provider, count: r.count })).catch(() => null)
        : null
      if (rival) {
        report.warning = `two authoritative stores are reachable here: "${client.provider}" (in use) and "${rival.provider}" (${rival.count} passports). One task must pick exactly one — point every harness at the same store.`
        report.other_provider = rival.provider
      }
      console.log(JSON.stringify(report))
    } catch (error) {
      console.log(JSON.stringify({
        ready: false,
        error: error.message,
        hint: storeDirectory() ? undefined : 'No --store given, so U-King was tried. Pass --store <directory> (or set TASK_PASSPORT_STORE) to use a plain local store instead.',
        hints: defaultUkingHints(),
      }))
      process.exitCode = 1
    }
    return
  }
  throw new Error(`unknown command: ${command}`)
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }))
  process.exitCode = 1
})
