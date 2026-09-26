import http from 'http'
import logger from 'loglevel'
import Router from './common/http/Router.js'
import FacetRegistry from './common/facets/FacetRegistry.js'
import Auth from './common/http/auth.js'
import { JSON_HEADERS, send } from './common/http/respond.js'
import { registerCommonRoutes } from './common/http/commonRoutes.js'

export { VOCABULARIES, STATIC_ROOT } from './common/http/commonRoutes.js'

/**
 * DIM HTTP server. Adapted from plugin-universe src/api/server.js.
 *
 * Common routes (src/common/http/commonRoutes.js): `/` (→ default facet),
 * `/health`, `/ns`, `/static/*`, `/login`, `/find`, `/r/…`, `/links`.
 * Everything else is registered by a facet under `/<facet-id>/` — see
 * src/facets.js for the list.
 *
 * services: { auth, repository, links } — the write path. Without them the
 * server is read-only (writes answer 403 and say why).
 */

/**
 * facets: facet objects in tab order (src/facets.js).
 * defaultFacet: id `/` redirects to; config `app.defaultFacet` when omitted.
 */
export function createRouter ({ facets, config = null, defaultFacet = null, projectRoot = process.cwd(), services = {} }) {
  const registry = new FacetRegistry(facets)
  const home = defaultFacet ?? config?.get('app.defaultFacet')
  if (!home || !registry.get(home)) {
    throw new Error(`Default facet ${JSON.stringify(home)} is not one of: ${registry.facets.map(f => f.id).join(', ')}`)
  }
  const allServices = { auth: services.auth ?? new Auth(), repository: services.repository ?? null, links: services.links ?? null }
  const origin = config?.get('site.origin') ?? null
  const router = new Router()
  registerCommonRoutes(router, { registry, services: allServices, config, defaultFacet: home, projectRoot, origin })
  registry.mount(router, { services: allServices, registry, origin })
  return { router, registry, services: allServices }
}

export function createServer (options) {
  const { router, registry, services } = createRouter(options)
  const tabs = registry.tabs()

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
    if (route.methodNotAllowed) return send(response, 405, { error: `${request.method} is not allowed here` })

    const session = { ...services.auth.identify(request), writesEnabled: services.auth.writesEnabled }
    try {
      return await route.handler({ request, response, url, match: route.match, started, session, services, tabs, registry })
    } catch (error) {
      // A handler may throw a client error (e.g. { status: 404 }); anything else is ours.
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500
      if (status === 500) logger.error('[server]', error)
      if (!response.headersSent) return send(response, status, { error: error.message })
      response.end()
    }
  })
}

export default createServer
