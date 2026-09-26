import http from 'http'
import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import logger from 'loglevel'
import Router from './common/http/Router.js'
import { JSON_HEADERS, LICENCE, send, sendText } from './common/http/respond.js'
import { registerRoutes as registerGnamgnam } from './gnamgnam/api/routes.js'

/**
 * DIM HTTP server. Adapted from plugin-universe src/api/server.js.
 * Common routes (health, vocabularies) live here; facet routes are
 * registered by each facet. Read-only for now.
 */

export const VOCABULARIES = Object.freeze({
  dim: 'vocabs/dim.ttl',
  shapes: 'vocabs/shapes.ttl'
})

function registerCommonRoutes (router, { search, config, projectRoot }) {
  router.get('/health', ({ response }) => send(response, 200, {
    status: 'ok',
    bookmarks: search.documents.size,
    index: search.index.size,
    embeddingModel: config?.get('embedding.model') ?? null,
    licence: LICENCE
  }))

  router.get('/ns', ({ response }) => send(response, 200, {
    vocabularies: Object.keys(VOCABULARIES).map(name => ({ name, url: `/ns/${name}.ttl` })),
    licence: LICENCE
  }))

  router.get(/^\/ns\/([a-z0-9-]+)\.ttl$/, async ({ response, match }) => {
    const file = VOCABULARIES[match[1]]
    if (!file) return send(response, 404, { error: 'No such vocabulary', name: match[1] })
    const body = await fs.promises.readFile(isAbsolute(file) ? file : pathJoin(projectRoot, file), 'utf8')
    return sendText(response, 200, body, 'text/turtle; charset=utf-8')
  })
}

export function createRouter ({ search, config, projectRoot = process.cwd() }) {
  if (!search) throw new Error('The server needs a SearchService')
  const router = new Router()
  registerCommonRoutes(router, { search, config, projectRoot })
  registerGnamgnam(router, { search })
  return router
}

export function createServer (options) {
  const router = createRouter(options)

  return http.createServer(async (request, response) => {
    const started = Date.now()
    let url
    try {
      url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)
    } catch {
      return send(response, 400, { error: 'Malformed URL' })
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, JSON_HEADERS)
      return response.end()
    }

    const path = url.pathname.replace(/\/$/, '') || '/'
    const route = router.match(request.method, path)
    if (!route) return send(response, 404, { error: 'No such endpoint', path })
    if (route.methodNotAllowed) return send(response, 405, { error: 'This API is read-only' })

    try {
      return await route.handler({ request, response, url, match: route.match, started })
    } catch (error) {
      logger.error('[server]', error)
      return send(response, 500, { error: error.message })
    }
  })
}

export default createServer
