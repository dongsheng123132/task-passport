#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { buildBag, mergeReceipt, readLuggage, readZip, recordSentAsks, unpackState, verifyBag, writeLuggage, writeZip } from './bag.js'
import { createPassportClient, defaultUkingHints, handoffPrompt } from './core.js'
import { runMcpServer } from './mcp.js'
import { outboxDirectory, readArchived, readOutbox, recordOutbound } from './outbox.js'
import { createDirectoryPassportProvider } from './store.js'
import { conformance, fromFlat, lintForExport, toFlat } from './taskpack.js'

const VERSION = '0.3.0'

/**
 * Read a TaskPack in either encoding. A zip starts with "PK"; anything else is
 * treated as the flat JSON form, which also covers the retired `.tpx` files that
 * are already sitting in people's chat histories.
 */
async function readPack(path, options = {}) {
  const raw = await readFile(path)
  const isZip = raw.length > 1 && raw[0] === 0x50 && raw[1] === 0x4b
  return isZip ? readZip(raw) : fromFlat(raw.toString('utf8').replace(/^﻿/, ''), options)
}

/**
 * Judging a pack must not silently benefit from the reader's own repairs, so read it
 * strictly first. If the file only parses once repaired, that IS the finding — report it
 * as a failed check rather than passing the repaired version.
 */
async function conformanceReport(path) {
  let repaired = null
  let entries
  try {
    entries = await readPack(path, { strict: true })
  } catch (error) {
    if (!/not conformant as written/.test(error.message)) throw error
    repaired = error.message
    entries = await readPack(path)
  }
  const report = conformance(entries)
  if (repaired) {
    report.ok = false
    report.total += 1
    report.checks.unshift({ id: 'C0', requirement: '文件本身就合规，不需要读取方替它修复', ok: false, detail: repaired })
  }
  return report
}

/** Where luggage lands when the caller did not say. Keeps it next to the store it belongs to. */
function luggageDirectory(passportId) {
  const store = storeDirectory()
  return option('--files-out') || (store ? join(store, `${passportId}.files`) : `${passportId}.files`)
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
  task-passport outbox [--passport <TP-ID>] [--limit <n>] [--show <n>] [--outbox <dir>]
                              发件台账：什么时候把哪一版发给了谁，包里有什么。--show 打开当时那份护照存根
  task-passport pack <TP-ID> --out <file> [--flat] [--file <path>]... [--actor <name>] [--to <who>] [--note <text>]
                              [--ask "要什么|什么算答完"]... [--check "要自检什么|怎么做"]...
                              [--asks <asks.json>] [--checks <checks.json>] [--kind receipt]
  task-passport unpack <file> [--store <directory>]          (别名: land) [--dry-run] [--files-out <dir>]
  task-passport land <file> --into <TP-ID>                   收下回执：答案写回提问的那本护照，不新开一本
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
    let opened = await client.open(argv[1])
    const files = await readLuggage(options('--file'))
    const asks = [...inlineAsks(), ...(await jsonOption('--asks'))]
    const landingChecks = [...inlineChecks(), ...(await jsonOption('--checks'))]

    // Warnings go to stderr so stdout stays a parseable contract. They are warnings,
    // not refusals: only the sender knows whether the receiver already has that drive.
    for (const warning of lintForExport({ state: opened.state, files, asks })) {
      console.error(`⚠ ${warning}`)
    }

    // Record what we asked, in the record that stays home.
    //
    // Without this the sender's passport has no memory of its own questions, so a
    // receipt coming back has nothing to merge into and every answer gets retyped by
    // hand. A task record that forgets what it asked is lying by omission — and it
    // fails in the quietest possible way, because the pack itself looks perfect.
    let asksRecorded = false
    if (asks.length) {
      const recorded = recordSentAsks(opened.state.asks, asks)
      if (recorded) {
        try {
          await client.checkpoint({ ...opened.state, asks: recorded }, opened.state_version)
          // Re-open so the pack ships the same version the passport now holds; otherwise
          // the pack's lineage points at a state that does not contain its own asks.
          opened = await client.open(argv[1])
          asksRecorded = true
        } catch (error) {
          // The pack is the deliverable. A read-only or contended store must not stop it
          // from being produced — but the operator has to hear that the receipt will not
          // auto-merge, so this is loud rather than swallowed.
          console.error(`⚠ 提出的 ask 没能记进护照（${error.message}）——回执回来时无法自动合并，需人工录入`)
        }
      } else {
        asksRecorded = true
      }
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
    const packBytes = flat ? Buffer.from(toFlat(bag), 'utf8') : writeZip(bag)
    await writeFile(out, packBytes)

    // A pack cannot be unsent, so the record is written on the way out. Never fatal:
    // failing to keep a diary must not stop the deliverable from being produced.
    const ledger = await recordOutbound(outboxDirectory({ outbox: option('--outbox'), store: storeDirectory() }), {
      entry: {
        passport_id: opened.state.id,
        state_version: opened.state_version,
        encoding: flat ? 'flat' : 'bagit-zip',
        out: basename(out),
        to: option('--to') || '',
        actor: option('--actor') || '',
        luggage: [...bag.keys()].filter((key) => key.startsWith('data/files/')).map((key) => key.slice('data/files/'.length)),
      },
      passport: JSON.parse(bag.get('data/passport.json').toString('utf8')),
      packBytes,
    })
    if (!ledger.ok) console.error(`⚠ 发件台账没写成（${ledger.error}）——这个包出门了但没有记录`)

    console.log(JSON.stringify({
      ok: true,
      pack: out,
      encoding: flat ? 'flat' : 'bagit-zip',
      passport_id: opened.state.id,
      state_version: opened.state_version,
      logged: ledger.ok,
      pack_sha256: ledger.entry.pack_sha256,
      entries: [...bag.keys()],
      asks: asks.length,
      // false means a receipt for this pack will need hand-merging — worth knowing now,
      // not when the answers come back.
      asks_recorded: asksRecorded,
      landing_checks: landingChecks.length,
      luggage: options('--file').map((path) => basename(path)),
    }))
    return
  }

  // 「上周发给客户的那个包里到底有什么？」— previously unanswerable, which is the whole
  // reason this command exists. `--show <n>` opens the archived passport for entry n.
  if (command === 'outbox') {
    const directory = outboxDirectory({ outbox: option('--outbox'), store: storeDirectory() })
    const report = await readOutbox(directory, {
      passportId: option('--passport'),
      limit: option('--limit') ? Number(option('--limit')) : undefined,
    })
    const show = option('--show')
    if (show) {
      const entry = report.entries[Number(show) - 1]
      if (!entry) throw new Error(`no ledger entry ${show} (there are ${report.entries.length})`)
      if (!entry.archived_passport) throw new Error(`ledger entry ${show} has no archived copy`)
      console.log(JSON.stringify({ ok: true, entry, passport: await readArchived(directory, entry.archived_passport) }))
      return
    }
    console.log(JSON.stringify({ ok: true, ...report }))
    return
  }

  if (command === 'conformance') {
    if (!argv[1] || argv[1].startsWith('-')) throw new Error('pack path is required')
    const report = await conformanceReport(argv[1])
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

    // A receipt is the answer coming home. Folding it into the passport that asked the
    // questions is the difference between "nothing gets dropped" and "a human retypes
    // fourteen answers", which is where a promise like that actually gets broken.
    const into = option('--into')
    if (into) {
      const opened = await client.open(into)
      // Merge first: its refusals (wrong kind, wrong task) must fire before anything
      // touches the disk, and a dry run that writes files is not a dry run.
      const { state, report } = mergeReceipt(passport, opened.state, { machine: hostname() })
      if (argv.includes('--dry-run')) {
        console.log(JSON.stringify({ ok: true, dry_run: true, passport_id: opened.state.id, would_land: files, ...report }))
        return
      }
      const landed = await writeLuggage(entries, luggageDirectory(opened.state.id))
      const withLuggage = landed.length
        ? { ...state, artifacts: [...(state.artifacts || []), ...landed.map((name) => `回执行李：${name}`)] }
        : state
      const saved = await client.checkpoint(withLuggage, opened.state_version)
      console.log(JSON.stringify({
        ok: true,
        merged_into: saved.passport_id,
        state_version: saved.state_version,
        luggage: landed,
        ...report,
      }))
      return
    }

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

    const landed = await writeLuggage(entries, luggageDirectory(created.passport_id))

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
