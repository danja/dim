import { registerRoutes } from './api/routes.js'
import { itemPath, feedPath } from './api/common.js'
import { tokenise } from '../common/search/LexicalIndex.js'
import { hostOf } from '../common/links/urls.js'
import { countTags } from '../common/facets/tags.js'

/**
 * News — the feed reader, after danja/NewsMonitor. Feeds and your
 * read/starred flags in graph:facet/news, items in graph:source/news. See
 * src/common/facets/FacetRegistry.js for the facet contract.
 *
 * tasks: Farelo's TaskStore, for "make a task" (optional).
 */

export function createNewsFacet ({ store, poller, tasks = null, fetchImpl = fetch }) {
  if (!store || !poller) throw new Error('News needs a NewsStore and a Poller')
  return {
    id: 'news',
    label: 'News',
    description: 'Feed reader: RSS, Atom and JSON Feed; save items as bookmarks or tasks.',
    types: { 'news-item': '/news/item/', feed: '/news/feed/' },

    routes (router, ctx) {
      registerRoutes(router, { store, poller, tasks, fetchImpl, ...ctx })
    },

    async health () {
      const feeds = await store.feedList()
      const counts = [...(await store.counts()).values()]
      return {
        status: 'ok',
        feeds: feeds.length,
        failing: feeds.filter(f => ['error', 'refused', 'gone'].includes(f.status)).length,
        items: counts.reduce((n, c) => n + c.total, 0),
        unread: counts.reduce((n, c) => n + c.unread, 0),
        polling: Boolean(poller.running)
      }
    },

    /** Feeds from one site (by the feed's own or its site's host). */
    async aboutDomain (host) {
      return (await store.feedList())
        .filter(f => hostOf(f.url) === host || hostOf(f.siteUrl) === host)
        .map(f => ({ label: f.title, href: feedPath(f), kind: 'feed' }))
    },

    /** Recent items (a month) and starred ones; older ones leave the index as they're pruned. */
    async documents () {
      const since = new Date(Date.now() - 30 * 86400000).toISOString()
      const { items } = await store.itemList({ view: 'all', limit: Infinity })
      return items.filter(i => i.starred || i.firstSeen >= since).map(i => ({ iri: i.iri, text: [i.title, i.snippet].filter(Boolean).join('\n\n') }))
    },

    /** Feed tags. */
    async tags () {
      return countTags((await store.feedList()).map(f => f.tags))
    },

    async tagged (tag) {
      return (await store.feedList()).filter(f => f.tags.includes(tag)).map(f => ({ iri: f.iri, label: f.title, href: feedPath(f), snippet: 'feed' }))
    },

    async lookup (resourceIri) {
      const f = await store.feedByIri(resourceIri)
      if (f) return { label: f.title, href: feedPath(f), type: 'feed' }
      const id = resourceIri.slice(resourceIri.lastIndexOf('/') + 1)
      const it = await store.item(id)
      return it?.iri === resourceIri ? { label: it.title, href: itemPath(it), type: 'news-item' } : null
    },

    /** Newest unread items (items aren't in the change log). */
    async recent ({ limit = 10 } = {}) {
      const { items } = await store.itemList({ view: 'unread', limit })
      return items.map(i => ({ iri: i.iri, label: i.title, href: itemPath(i), at: i.published ?? i.firstSeen, action: 'new', summary: null }))
    },

    async lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      return (await store.feedList()).find(f => f.title.toLowerCase() === wanted)?.iri ?? null
    },

    /** Feeds by title, then items (newest first) with every word in title or text. */
    async find (q, { limit = 10 } = {}) {
      const words = tokenise(q)
      if (!words.length) return []
      const feeds = (await store.feedList()).filter(f => words.every(w => f.title.toLowerCase().includes(w)))
        .map(f => ({ iri: f.iri, label: f.title, href: feedPath(f), snippet: 'feed' }))
      const { items } = await store.itemList({ view: 'all', limit: Infinity })
      const hits = items.filter(i => {
        const text = `${i.title} ${i.snippet ?? ''}`.toLowerCase()
        return words.every(w => text.includes(w))
      }).map(i => ({ iri: i.iri, label: i.title, href: itemPath(i), snippet: (i.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160) }))
      return [...feeds, ...hits].slice(0, limit)
    }
  }
}

export default createNewsFacet
