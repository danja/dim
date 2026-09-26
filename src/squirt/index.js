import { registerRoutes } from './api/routes.js'
import { mentionSync } from '../wiki/mentionSync.js'

/**
 * Squirt — DIM on the phone, after danja/squirt: search first, one capture
 * box that routes to the right facet, recent activity across facets, and
 * an installable app (manifest, service worker, share target).
 *
 * client: the SPARQL client (change log, bookmark checks); tasks / wiki:
 * Farelo's TaskStore and the WikiStore, where captures land.
 */

export function createSquirtFacet ({ client = null, tasks = null, wiki = null, links = null, advisor = null, appName = 'DIM' }) {
  return {
    id: 'squirt',
    label: 'Squirt',
    description: 'Mobile view of everything, with quick capture.',

    routes (router, ctx) {
      const mentions = wiki ? mentionSync({ store: wiki, links: ctx.services?.links ?? links, registry: ctx.registry, origin: ctx.origin }) : null
      registerRoutes(router, { client, tasks, wiki, mentions, advisor, appName, ...ctx })
    },

    health () {
      return { status: 'ok', capture: { tasks: Boolean(tasks), notes: Boolean(wiki), bookmarks: Boolean(client) } }
    }
  }
}

export default createSquirtFacet
