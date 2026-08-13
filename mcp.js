#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { createPassportClient } from './core.js'

const SERVER_VERSION = '0.2.1'
const SUPPORTED_PROTOCOLS = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])

export const passportTools = [
  {
    name: 'task_passport_list',
    description: 'List task passports without loading their full bodies. Use this to discover or resolve an exact passport id. Read-only.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'task_passport_open',
    description: 'Open exactly one task passport. Returns durable state, bounded context, and the version required for a safe checkpoint. Read-only.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['passport_id'],
      properties: {
        passport_id: { type: 'string', description: 'Exact id, for example TP-7K4M-9D2Q.' },
      },
    },
  },
  {
    name: 'task_passport_new',
    description: 'Create one durable task passport for one objective. A passport can span multiple sessions and harnesses.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'goal'],
      properties: {
        title: { type: 'string', description: 'Short display name.' },
        goal: { type: 'string', description: 'One-sentence objective.' },
        current_state: { type: 'string', description: 'What verified reality looks like now.' },
        next_step: { type: 'string', description: 'First verifiable next step.' },
      },
    },
  },
  {
    name: 'task_passport_checkpoint',
    description: 'Checkpoint changed durable state. A stale expected_version is rejected instead of silently overwriting another harness.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['state', 'expected_version'],
      properties: {
        state: { type: 'object', additionalProperties: true, description: 'Updated state object returned by task_passport_open.' },
        expected_version: { type: 'integer', minimum: 0, description: 'state_version read before editing.' },
      },
    },
  },
]

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value,
  }
}

function toolError(error) {
  return {
    content: [{ type: 'text', text: error?.message || String(error) }],
    isError: true,
  }
}

export function createMcpRequestHandler(options = {}) {
  const client = options.client ?? createPassportClient({
    ukingExecutable: options.ukingExecutable,
    harness: options.harness || process.env.TASK_PASSPORT_HARNESS || 'mcp',
  })

  return async function handle(request) {
    if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
      throw Object.assign(new Error('Invalid JSON-RPC request'), { code: -32600 })
    }

    if (request.method === 'initialize') {
      const requested = request.params?.protocolVersion
      return {
        protocolVersion: SUPPORTED_PROTOCOLS.has(requested) ? requested : '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'task-passport', version: SERVER_VERSION },
        instructions: 'Use task passports as durable cross-harness state. Never guess a recent passport, inherit chat logs, or overwrite a stale version.',
      }
    }
    if (request.method === 'ping') return {}
    if (request.method === 'tools/list') return { tools: passportTools }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      try {
        if (name === 'task_passport_list') return toolResult(await client.list())
        if (name === 'task_passport_open') return toolResult(await client.open(args.passport_id))
        if (name === 'task_passport_new') {
          return toolResult(await client.create({
            title: args.title,
            goal: args.goal,
            currentState: args.current_state,
            nextStep: args.next_step,
          }))
        }
        if (name === 'task_passport_checkpoint') {
          return toolResult(await client.checkpoint(args.state, args.expected_version))
        }
        throw new Error(`Unknown tool: ${name}`)
      } catch (error) {
        return toolError(error)
      }
    }
    if (request.method.startsWith('notifications/')) return undefined
    throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 })
  }
}

function rpcError(id, error) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: Number.isInteger(error?.code) ? error.code : -32603,
      message: error?.message || String(error),
    },
  }
}

export async function runMcpServer(options = {}) {
  const handle = createMcpRequestHandler(options)
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })

  for await (const line of lines) {
    const payload = line.replace(/^\uFEFF/, '')
    if (!payload.trim()) continue
    let request
    try {
      request = JSON.parse(payload)
      const result = await handle(request)
      if (request.id === undefined || result === undefined) continue
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`)
    } catch (error) {
      if (request?.id === undefined && request) continue
      process.stdout.write(`${JSON.stringify(rpcError(request?.id, error))}\n`)
    }
  }
}
