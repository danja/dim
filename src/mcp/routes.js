import { send } from '../common/http/respond.js'
import { readBody } from '../common/http/body.js'
import { handleMessage, rpcError } from './protocol.js'

/**
 * POST /mcp — DIM for agents (src/mcp/tools.js). The owner's token is always
 * required, as Bearer or Basic: a browser session cookie is refused, so a web
 * page can never drive it. A browser Origin other than DIM's own is refused
 * too (DNS rebinding); agents send none.
 */

function sameOrigin (request, origin) {
  const from = request.headers.origin
  if (!from) return true
  try {
    const host = new URL(from).host
    return host === request.headers.host || (origin && host === new URL(origin).host)
  } catch {
    return false
  }
}

export function registerMcpRoutes (router, { services, origin = null, fetchImpl = globalThis.fetch }) {
  router.add(['POST', 'GET', 'DELETE'], '/mcp', async ({ request, response }) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST')
      return send(response, 405, { error: 'MCP here is POST-only JSON-RPC; there is no event stream or session to open' })
    }
    if (!sameOrigin(request, origin)) return send(response, 403, { error: 'Cross-origin request refused' })
    if (!services.auth.writesEnabled) return send(response, 403, { error: 'MCP needs DIM_WRITE_TOKEN: set it in .env and restart' })
    const identity = services.auth.identify(request)
    if (!identity.user || identity.via === 'session') {
      response.setHeader('WWW-Authenticate', 'Bearer')
      return send(response, 401, { error: 'Send the write token: Authorization: Bearer <DIM_WRITE_TOKEN>' })
    }
    let message
    try {
      message = await readBody(request)
    } catch (error) {
      return send(response, error.status ?? 400, rpcError(null, -32700, error.message))
    }
    const reply = await handleMessage(message, {
      fetch: fetchImpl,
      base: `http://127.0.0.1:${request.socket.localPort}`,
      authorization: request.headers.authorization
    })
    if (!reply) {
      response.writeHead(202, { 'Content-Length': 0 })
      return response.end()
    }
    return send(response, 200, reply)
  })
}

export default registerMcpRoutes
