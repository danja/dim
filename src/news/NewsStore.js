import { iri } from '../common/store/SPARQLHelper.js'
import { insertGroups, writeFlag, deleteSubjects, replaceDirect } from './writes.js'
import QueryService from '../common/store/QueryService.js'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { FEED_PREDICATES, POLL_PREDICATES, feedTriples, pollTriples, itemTriples, feedSlug, feedIri, itemId, itemIri } from './rdf.js'
import { loadNews } from './load.js'
import { absoluteUrl } from './formats/feed.js'

/**
 * Feeds, items and read/starred state, held in memory (loaded once) and
 * written through.
 *
 *   graph:facet/news   feeds (subscription edits go through the Repository:
 *                      validated, change-logged) + poll status + your flags
 *   graph:source/news  items: third-party text, 'proprietary-linkout'
 *
 * Poll status and read/starred flags are operational: written directly
 * (no change-log entry per poll or per click).
 */

export const MAX_TAGS = 10
const OWNER = NAMESPACES.dim + 'facet/news'

export class NewsError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'NewsError'
    this.status = status
  }
}

export function cleanTags (value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(raw.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
}

const itemDate = item => item.published ?? item.firstSeen

export class NewsStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('NewsStore needs a client and a Repository')
    Object.assign(this, { client, repository, links, queries, now })
    this.feeds = null // slug → feed
    this.items = null // id → item
    this.sourceGraph = null
  }

  async graph () {
    return this.repository.facetGraph('news', { comment: 'News: feed subscriptions, poll status, read/starred flags' })
  }

  async itemGraph () {
    if (this.sourceGraph) return this.sourceGraph
    const registry = this.repository.registry
    if (!(await registry.isRegistered('source', 'news'))) {
      await registry.register({ kind: 'source', id: 'news', licence: 'proprietary-linkout', derivedFrom: OWNER, comment: 'Items fetched from subscribed feeds (third-party text; link out, do not redistribute)' })
    }
    this.sourceGraph = registry.constructor.graphIri('source', 'news')
    return this.sourceGraph
  }

  // ── Loading ──────────────────────────────────────────────────────────

  async #load () {
    if (this.feeds) return
    const loaded = await loadNews(this.client, this.queries, { facet: await this.graph(), items: await this.itemGraph() })
    this.feeds = loaded.feeds
    this.items = loaded.items
  }

  /** Forget the cache (after the command line changed the store). */
  reset () {
    this.feeds = null
    this.items = null
  }

  async feedList () {
    await this.#load()
    return [...this.feeds.values()].sort((a, b) => a.title.localeCompare(b.title))
  }

  async feed (slug) {
    await this.#load()
    return this.feeds.get(slug) ?? null
  }

  async feedByIri (value) {
    await this.#load()
    return [...this.feeds.values()].find(f => f.iri === value) ?? null
  }

  async feedByUrl (url) {
    await this.#load()
    return [...this.feeds.values()].find(f => f.url === url) ?? null
  }

  async item (id) {
    await this.#load()
    return this.items.get(id) ?? null
  }

  async itemText (item) {
    const [row] = await this.client.select(this.queries.get('news/item-text', { graph: iri(await this.itemGraph()), item: iri(item.iri) }))
    return row?.text ?? null
  }

  /**
   * Items newest first. view: unread | all | starred; feed: slug; tag: a
   * feed tag; before: ISO date (paging); q: words in title/snippet.
   */
  async itemList ({ view = 'unread', feed = null, tag = null, before = null, limit = 50 } = {}) {
    await this.#load()
    const feedIris = tag ? new Set([...this.feeds.values()].filter(f => f.tags.includes(tag)).map(f => f.iri)) : null
    const wanted = feed ? this.feeds.get(feed)?.iri ?? '-' : null
    const matches = [...this.items.values()].filter(i =>
      (view === 'all' || (view === 'starred' ? i.starred : !i.read)) &&
      (!wanted || i.feed === wanted) &&
      (!feedIris || feedIris.has(i.feed)) &&
      (!before || itemDate(i) < before))
    matches.sort((a, b) => itemDate(b).localeCompare(itemDate(a)))
    return { items: matches.slice(0, limit), more: matches.length > limit }
  }

  /** feed iri → { total, unread, starred } */
  async counts () {
    await this.#load()
    const out = new Map()
    for (const i of this.items.values()) {
      const c = out.get(i.feed) ?? { total: 0, unread: 0, starred: 0 }
      c.total++
      if (!i.read) c.unread++
      if (i.starred) c.starred++
      out.set(i.feed, c)
    }
    return out
  }

  // ── Feeds ────────────────────────────────────────────────────────────

  async addFeed ({ url, title, siteUrl = null, tags = [], format = null }, actor) {
    await this.#load()
    if (await this.feedByUrl(url)) throw new NewsError(`Already subscribed to ${url}`, 409)
    const slug = feedSlug(url)
    const feed = { slug, iri: feedIri(slug), url, title: String(title || url).trim().slice(0, 300), siteUrl, tags: cleanTags(tags), created: this.now().toISOString(), format, status: 'new', lastPolled: null, nextPoll: null, failures: 0, lastError: null, httpStatus: null, etag: null, lastModified: null }
    await this.repository.replace({ graph: await this.graph(), subject: feed.iri, predicates: FEED_PREDICATES, triples: feedTriples(feed), actor, summary: `subscribed to ${feed.title}` })
    await replaceDirect(this.client, await this.graph(), feed.iri, POLL_PREDICATES, pollTriples(feed))
    this.feeds.set(slug, feed)
    return feed
  }

  async updateFeed (feed, { title, tags, siteUrl }, actor) {
    const next = { ...feed }
    if (siteUrl !== undefined) next.siteUrl = siteUrl || null
    if (title !== undefined) next.title = String(title).trim().slice(0, 300) || feed.title
    if (tags !== undefined) next.tags = cleanTags(tags)
    await this.repository.replace({ graph: await this.graph(), subject: feed.iri, predicates: FEED_PREDICATES, triples: feedTriples(next), actor, summary: 'feed settings' })
    Object.assign(feed, next)
    return feed
  }

  /** After a poll: status fields (and the feed's own title/site when first learnt). */
  async recordPoll (feed, fields) {
    Object.assign(feed, fields)
    await replaceDirect(this.client, await this.graph(), feed.iri, POLL_PREDICATES, pollTriples(feed))
  }

  async deleteFeed (feed, actor) {
    await this.#load()
    const items = [...this.items.values()].filter(i => i.feed === feed.iri)
    await this.#deleteItems(items)
    await this.repository.deleteResources({ graph: await this.graph(), subjects: [feed.iri], actor, summary: `unsubscribed from ${feed.title}` })
    if (this.links) await this.links.forget([feed.iri])
    this.feeds.delete(feed.slug)
    return items.length
  }

  // ── Items ────────────────────────────────────────────────────────────

  /** Parsed items not seen before → stored. → the new items. */
  async addItems (feed, parsed) {
    await this.#load()
    const at = this.now().toISOString()
    let fresh = []
    const ids = new Set()
    for (const p of parsed) {
      const id = itemId(feed.iri, p.guid)
      if (this.items.has(id) || ids.has(id)) continue
      ids.add(id)
      fresh.push({ id, iri: itemIri(id), feed: feed.iri, title: p.title, link: p.link ? absoluteUrl(p.link, null) : null, guid: p.guid.slice(0, 2000), published: p.published, firstSeen: at, author: p.author, summary: p.summary, snippet: p.summary?.slice(0, 400) ?? null, categories: p.categories, read: false, starred: false })
    }
    if (!fresh.length) return []
    const validator = this.repository.validator
    if (!(await validator.validateTriples(fresh.flatMap(itemTriples))).conforms) {
      // Keep the good ones; one malformed item must not block a feed.
      const ok = []
      for (const item of fresh) if ((await validator.validateTriples(itemTriples(item))).conforms) ok.push(item)
      fresh = ok
    }
    await insertGroups(this.client, await this.itemGraph(), fresh.map(itemTriples))
    for (const item of fresh) {
      delete item.summary
      this.items.set(item.id, item)
    }
    return fresh
  }

  async setFlags (items, { read, starred }) {
    let touched = 0
    for (const [key, value] of [['read', read], ['starred', starred]]) {
      if (value === undefined) continue
      const change = items.filter(i => i[key] !== value)
      await writeFlag(this.client, await this.graph(), change, key, value)
      for (const item of change) item[key] = value
      touched += change.length
    }
    return touched
  }

  /** Delete items first seen more than `days` ago, unless starred. → count. */
  async prune ({ days }) {
    await this.#load()
    const cutoff = new Date(this.now().getTime() - days * 86400000).toISOString()
    const old = [...this.items.values()].filter(i => !i.starred && i.firstSeen < cutoff)
    await this.#deleteItems(old)
    return old.length
  }

  async #deleteItems (items) {
    if (!items.length) return
    const subjects = items.map(i => i.iri)
    await deleteSubjects(this.client, [await this.itemGraph(), await this.graph()], subjects)
    if (this.links) await this.links.forget(subjects)
    for (const item of items) this.items.delete(item.id)
  }
}

export default NewsStore
