#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createPassportClient, defaultUkingHints, handoffPrompt } from './core.js'
import { runMcpServer } from './mcp.js'
import { createDirectoryPassportProvider } from './store.js'

const argv = process.argv.slice(2)

function option(name) {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}

function requiredOption(name) {
  const value = option(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function usage() {
  return `Task Passport 0.2.2

Usage:
  task-passport list [--uking <path> | --store <directory>]
  task-passport open <TP-ID> [--uking <path> | --store <directory>]
  task-passport prompt <TP-ID>
  task-passport new --title <text> --goal <text> [--current-state <text>] [--next-step <text>] [--store <directory>]
  task-passport checkpoint --file <state.json> --expected-version <n> [--store <directory>]
  task-passport doctor [--uking <path> | --store <directory>]
  task-passport mcp [--uking <path> | --store <directory>]

stdout is JSON except for the prompt command. Long state must go through --file.`
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
    console.log('0.2.2')
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
    const state = JSON.parse(await readFile(requiredOption('--file'), 'utf8'))
    const expectedVersion = Number(requiredOption('--expected-version'))
    console.log(JSON.stringify(await client.checkpoint(state, expectedVersion)))
    return
  }
  if (command === 'doctor') {
    try {
      const result = await client.list()
      console.log(JSON.stringify({ ready: true, provider: client.provider, passport_count: result.count }))
    } catch (error) {
      console.log(JSON.stringify({ ready: false, error: error.message, hints: defaultUkingHints() }))
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
