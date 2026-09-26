import http from 'http'
import fs from 'fs'
import { join as pathJoin, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import logger from 'loglevel'
import Router from './common/http/Router.js'
import FacetRegistry from './common/facets/FacetRegistry.js'
import { registerStatic } from './common/http/staticFiles.js'
import { JSON_HEADERS, LICENCE, send, sendText, redirect } from './common/http/respond.js'

/**
 * DIM HTTP server. Adapted from plugin-universe src/api/server.js.
 *
 * Common routes live here: `/` (→ default facet), `/health`, `/ns`, and
 * `/static/*` (the shared UI kit). Everything else is registered by a
 * facet under `/<facet-id>/` — see src/facets.js for the list.
 */

export const VOCABULARIES = Object.freeze({
  dim: 'vocabs/dim.ttl',
  shapes: 'vocabs/shapes.ttl'
})

export const STATIC_ROOT = fileURLToPath(new URL('./common/ui/public/', import.meta.url))

function registerCommonRoutes (router, { registry, config, defaultFacet, projectRoot }) {
  router.get('/', ({ response, url }) => redirect(response, 302, `/${defaultFacet}/${url.search}`))

  router.get('/health', async ({ response }) => send(response, 200, {
    status: 'ok',
    facets: await registry.health(),
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

  registerStatic(router, { prefix: '/static', root: STATIC_ROOT })
}

/**
 * facets: facet objects in tab order (src/facets.js).
 * defaultFacet: id `/` redirects to; config `app.defaultFacet` when omitted.
 */
export function createRouter ({ facets, config = null, defaultFacet = null, projectRoot = process.cwd() }) {
  const registry = new FacetRegistry(facets)
  const home = defaultFacet ?? config?.get('app.defaultFacet')
  if (!home || !registry.get(home)) {
    throw new Error(`Default facet ${JSON.stringify(home)} is not one of: ${registry.facets.map(f => f.id).join(', ')}`)
  }
  const router = new Router()
  registerCommonRoutes(router, { registry, config, defaultFacet: home, projectRoot })
  registry.mount(router, {})
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
