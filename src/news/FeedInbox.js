import { createHash } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { hostOf } from '../common/links/urls.js'
import { feedsOnPage } from './feedsOnPage.js'
import { deleteSubjects, replaceDirect } from './writes.js'

/**
 * The feed inbox: feeds found on bookmarked pages, waiting for you to
 * subscribe or dismiss (on Manage feeds). One suggestion per feed URL, with
 * every bookmark it was found on; feeds you already read are not suggested,
 * and a dismissed one is not suggested again. Kept in graph:facet/news:
 *
 *   dim:feed-suggestion/<hash16>  a dim:FeedSuggestion ; dim:suggestedFeed <url> ;
 *     dcterms:title ; dim:foundOn <page> ; dcterms:source <bookmark>… ;
 *     dcterms:created ; dim:suggestionStatus "new" | "dismissed"
 *
 * Machine-found, so written directly (like poll status), not change-logged.
 */

const { dim, rdf, dcterms } = NAMESPACES
const STATUS = dim + 'suggestionStatus'
export const suggestionId = url => createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 16)

export class FeedInbox {
  constructor ({ client, news, queries = new QueryService(), now = () => new Date() }) {
    Object.assign(this, { client, news, queries, now })
    this.suggestions = null // feed url → suggestion
  }

  // Re-read now and then: bin/feed-scan.js adds suggestions behind the server's back.
  async #load () {
    if (this.suggestions && Date.now() - this.loadedAt < 30000) return this.suggestions
    this.loadedAt = Date.now()
    const rows = await this.client.select(this.queries.get('news/suggestions', { graph: iri(await this.news.graph()) }))
    this.suggestions = new Map(rows.map(r => [r.feed, {
      id: suggestionId(r.feed),
      iri: r.suggestion,
      url: r.feed,
      title: r.title ?? null,
      foundOn: r.foundOn ?? null,
      created: r.created ?? null,
      status: r.status,
      sources: (r.sources ?? '').split(' ').filter(Boolean)
    }]))
    return this.suggestions
  }

  reset () {
    this.suggestions = null
  }

  /** Waiting suggestions (or dismissed ones), newest first. */
  async list ({ status = 'new' } = {}) {
    return [...(await this.#load()).values()].filter(s => s.status === status)
      .sort((a, b) => String(b.created).localeCompare(String(a.created)))
  }

  async byIds (ids) {
    const wanted = new Set(ids)
    return [...(await this.#load()).values()].filter(s => wanted.has(s.id))
  }

  /** Sites that already have a suggestion (any status) or a subscription. */
  async knownHosts () {
    const hosts = new Set([...(await this.#load()).values()].flatMap(s => [hostOf(s.url), hostOf(s.foundOn)]))
    for (const f of await this.news.feedList()) for (const u of [f.url, f.siteUrl]) hosts.add(hostOf(u))
    hosts.delete(null)
    return hosts
  }

  /**
   * A fetched page: note the feeds it offers. source: the bookmark's IRI.
   * → { found, added: [suggestion] } (found: feeds on the page, before
   * dropping ones already read or suggested)
   */
  async addFromPage ({ html, pageUrl, source = null }) {
    const feeds = feedsOnPage(html, pageUrl)
    const map = await this.#load()
    const graph = await this.news.graph()
    const added = []
    for (const feed of feeds) {
      if (await this.news.feedByUrl(feed.url)) continue
      const known = map.get(feed.url)
      if (known) {
        if (source && !known.sources.includes(source)) {
          await this.client.update(insertDataQuery(graph, [`${iri(known.iri)} ${iri(dcterms + 'source')} ${iri(source)} .`]))
          known.sources.push(source)
        }
        continue
      }
      const id = suggestionId(feed.url)
      const s = { id, iri: `${dim}feed-suggestion/${id}`, url: feed.url, title: feed.title, foundOn: pageUrl, created: this.now().toISOString(), status: 'new', sources: source ? [source] : [] }
      const subject = iri(s.iri)
      const triples = [
        `${subject} ${iri(rdf + 'type')} ${iri(dim + 'FeedSuggestion')} .`,
        `${subject} ${iri(dim + 'suggestedFeed')} ${iri(s.url)} .`,
        `${subject} ${iri(dim + 'foundOn')} ${iri(pageUrl)} .`,
        `${subject} ${iri(dcterms + 'created')} ${typedLiteral(new Date(s.created))} .`,
        `${subject} ${iri(STATUS)} ${literal('new')} .`,
        ...(s.title ? [`${subject} ${iri(dcterms + 'title')} ${literal(s.title.slice(0, 300))} .`] : []),
        ...s.sources.map(b => `${subject} ${iri(dcterms + 'source')} ${iri(b)} .`)
      ]
      await this.client.update(insertDataQuery(graph, triples))
      map.set(s.url, s)
      added.push(s)
    }
    return { found: feeds.length, added }
  }

  /** Not interested: kept (so it isn't suggested again), hidden. */
  async dismiss (suggestions) {
    const graph = await this.news.graph()
    for (const s of suggestions) {
      await replaceDirect(this.client, graph, s.iri, [STATUS], [`${iri(s.iri)} ${iri(STATUS)} ${literal('dismissed')} .`])
      s.status = 'dismissed'
    }
  }

  /** Gone from the inbox (subscribed to). */
  async remove (suggestions) {
    if (!suggestions.length) return
    await deleteSubjects(this.client, [await this.news.graph()], suggestions.map(s => s.iri))
    const map = await this.#load()
    for (const s of suggestions) map.delete(s.url)
  }

  /** For the enricher: every fetched web page is checked for feeds. */
  observer () {
    return {
      observe: async ({ bookmarkIri, url, fetched }) => {
        if (/html/i.test(fetched.contentType ?? '')) await this.addFromPage({ html: fetched.body, pageUrl: fetched.url || url, source: bookmarkIri })
      }
    }
  }
}

export default FeedInbox
