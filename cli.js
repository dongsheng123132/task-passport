#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createPassportClient, defaultUkingHints, handoffPrompt } from './core.js'
import { runMcpServer } from './mcp.js'

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
  return `Task Passport 0.2.1

Usage:
  task-passport list [--uking <path>]
  task-passport open <TP-ID> [--uking <path>]
  task-passport prompt <TP-ID>
  task-passport new --title <text> --goal <text> [--current-state <text>] [--next-step <text>]
  task-passport checkpoint --file <state.json> --expected-version <n>
  task-passport doctor [--uking <path>]
  task-passport mcp [--uking <path>]

stdout is JSON except for the prompt command. Long state must go through --file.`
}

async function main() {
  const command = argv[0]
  if (!command || command === '--help' || command === '-h') {
    console.log(usage())
    return
  }
  if (command === '--version' || command === '-v') {
    console.log('0.2.1')
    return
  }

  if (command === 'mcp') {
    await runMcpServer({
      ukingExecutable: option('--uking'),
      harness: process.env.TASK_PASSPORT_HARNESS || 'mcp',
    })
    return
  }

  const client = createPassportClient({
    ukingExecutable: option('--uking'),
    harness: process.env.TASK_PASSPORT_HARNESS || 'task-passport-cli',
  })

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
      console.log(JSON.stringify({ ready: true, passport_count: result.count }))
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
