import { toolList, callTool } from './tools.js'

/**
 * MCP over HTTP (Streamable HTTP, stateless: every POST is one JSON-RPC
 * message answered with one JSON body; no sessions, no SSE). Only tools are
 * offered. Batches are refused, as in the 2025-06-18 revision.
 */

export const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
export const SERVER_INFO = { name: 'dim', title: 'DIM — Danny\'s Information Manager', version: '0.1.0' }

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
const ok = (id, result) => ({ jsonrpc: '2.0', id, result })

/** → a JSON-RPC response object, or null for a notification (answer 202). */
export async function handleMessage (message, ctx) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Not a JSON-RPC 2.0 request')
  const { id, method, params } = message
  const isNotification = id === undefined
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion
      return ok(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'DIM is the owner\'s personal information manager (bookmarks, outlines, tasks, wiki, news, blog). You act as the owner: writes are real. Start with dim_endpoints, use dim_search to find things and dim_get to read them.'
      })
    }
    case 'ping': return isNotification ? null : ok(id, {})
    case 'tools/list': return ok(id, { tools: toolList() })
    case 'tools/call': {
      if (typeof params?.name !== 'string') return rpcError(id, -32602, 'tools/call needs a tool name')
      const result = await callTool(ctx, params.name, params.arguments)
      return result ? ok(id, result) : rpcError(id, -32602, `Unknown tool: ${params.name}`)
    }
    default:
      if (isNotification) return null // notifications/initialized, cancelled…
      return rpcError(id, -32601, `Method not found: ${method}`)
  }
}

export { rpcError }
