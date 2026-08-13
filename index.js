import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createPassportClient } from './core.js'
import { createDirectoryPassportProvider } from './store.js'

export const name = 'task-passport'
export const inject = ['tools', 'systemPrompt']

export const Config = z.object({
  ukingExecutable: z.string().default(''),
  storeDirectory: z.string().default(''),
  allowCheckpoint: z.boolean().default(true),
})

const SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passport_id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    goal: { type: 'string', required: true },
    current_state: { type: 'string', required: true },
    state_version: { type: 'integer', required: true },
    updated_at: { type: 'string', required: true },
    last_harness: { type: 'string', required: true },
  },
}

const OPEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passport_id: { type: 'string', required: true },
    state_version: { type: 'integer', required: true },
    state: { type: 'object', required: true, additionalProperties: true },
    compiled_context: { type: 'string', required: true },
    handoff_prompt: { type: 'string', required: true },
  },
}

const CHECKPOINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passport_id: { type: 'string', required: true },
    state_version: { type: 'integer', required: true },
    state: { type: 'object', required: true, additionalProperties: true },
    handoff_prompt: { type: 'string', required: true },
  },
}

export function apply(ctx, config) {
  const client = createPassportClient({
    ukingExecutable: config.ukingExecutable || undefined,
    provider: config.storeDirectory
      ? createDirectoryPassportProvider({ directory: config.storeDirectory })
      : undefined,
    harness: 'deepseek-harness',
  })

  ctx.systemPrompt.section({
    name: 'tool:task-passport',
    order: 113,
    text: [
      'Task Passport is durable task state shared across AI harnesses, not a chat transcript.',
      'A project can contain multiple passports and one passport can span multiple sessions.',
      'Never guess or silently choose the most recently changed passport.',
      'When the user gives an id, open that exact passport. When only a title is given, list passports and continue only if the match is unique.',
      'Inherit verified facts, decisions with reasons, current state, and next steps. Do not inherit another harness\'s conversation.',
      'Before handing off after material work, checkpoint the changed world state using the version returned by open. On conflict, reopen and merge; never overwrite.',
    ].join(' '),
  })

  ctx.tools.register(defineTool({
    name: 'task_passport_list',
    description: 'List task passports without loading their full bodies. Use this to resolve a title or discover the exact passport id. Read-only.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          passports: { type: 'array', required: true, items: SUMMARY_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute() {
      return await client.list()
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_passport_open',
    description: 'Open exactly one task passport and return its durable state plus a bounded context block. Never auto-selects a recent task. Read-only.',
    parameters: {
      passport_id: { type: 'string', required: true, description: 'Exact id, for example TP-7K4M-9D2Q.' },
    },
    output: {
      schema: OPEN_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: value.compiled_context }],
    },
    async execute(args) {
      return await client.open(args.passport_id)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_passport_new',
    description: 'Create a durable task passport with a stable human-readable id. Use one passport per objective, not one per chat message or harness session.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short display name.' },
      goal: { type: 'string', required: true, description: 'One-sentence objective that another model can understand.' },
      current_state: { type: 'string', description: 'What the world looks like now. Defaults to not started.' },
      next_step: { type: 'string', description: 'First verifiable next step.' },
    },
    output: {
      schema: CHECKPOINT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: `${value.passport_id} v${value.state_version}\n${value.handoff_prompt}` }],
    },
    async execute(args) {
      if (!config.allowCheckpoint) throw new Error('Task Passport writes are disabled by this profile')
      return await client.create({
        title: args.title,
        goal: args.goal,
        currentState: args.current_state,
        nextStep: args.next_step,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'task_passport_checkpoint',
    description: 'Checkpoint changed task state for another harness. Requires the exact state and state_version returned by open; a stale version is rejected instead of overwriting.',
    parameters: {
      state: { type: 'object', required: true, additionalProperties: true, description: 'The state object returned by task_passport_open, updated to reflect verified reality.' },
      expected_version: { type: 'integer', required: true, description: 'The state_version read before editing.' },
    },
    output: {
      schema: CHECKPOINT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: `${value.passport_id} v${value.state_version}\n${value.handoff_prompt}` }],
    },
    async execute(args) {
      if (!config.allowCheckpoint) throw new Error('Task Passport writes are disabled by this profile')
      return await client.checkpoint(args.state, args.expected_version)
    },
  }))
}
