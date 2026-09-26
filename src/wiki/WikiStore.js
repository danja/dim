import { iri } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { PAGE_PREDICATES, pageTriples, revisionTriples, pageIri, revisionIri, slugForTitle } from './rdf.js'

/**
 * Wiki pages in graph:facet/wiki. Current pages are held in memory (loaded
 * once); every save writes the page and a full revision through the Phase 4
 * write path. Saving against a stale revision is refused (409) so two
 * edits can't silently overwrite each other.
 */

export const MAX_TAGS = 20

export class WikiError extends Error {
  constructor (message, status = 400, extra = {}) {
    super(message)
    this.name = 'WikiError'
    this.status = status
    Object.assign(this, extra)
  }
}

function cleanTags (value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(raw.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
}

export class WikiStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('WikiStore needs a client and a Repository')
    Object.assign(this, { client, repository, links, queries, now })
    this.pages = null
  }

  async graph () {
    return this.repository.facetGraph('wiki', { comment: 'Wiki pages and their revisions' })
  }

  async all () {
    if (this.pages) return this.pages
    const rows = await this.client.select(this.queries.get('wiki/pages', { graph: iri(await this.graph()) }))
    this.pages = new Map(rows.map(r => {
      const slug = r.page.slice(r.page.lastIndexOf('/') + 1)
      return [slug, {
        slug,
        iri: r.page,
        title: r.title,
        content: r.content,
        created: r.created ?? null,
        modified: r.modified ?? null,
        revision: Number(r.revision),
        tags: r.tags ? r.tags.split(', ').filter(Boolean) : []
      }]
    }))
    return this.pages
  }

  /** Forget the cache (after an import from the command line). */
  reset () {
    this.pages = null
  }

  async list () {
    return [...(await this.all()).values()]
  }

  async get (slug) {
    return (await this.all()).get(slug) ?? null
  }

  async byIri (resourceIri) {
    const s = String(resourceIri ?? '')
    const page = await this.get(s.slice(s.lastIndexOf('/') + 1))
    return page?.iri === s ? page : null
  }

  async byTitle (title) {
    const wanted = String(title ?? '').trim().toLowerCase()
    return (await this.list()).find(p => p.title.toLowerCase() === wanted) ?? (await this.get(slugForTitle(title)))
  }

  /**
   * Create or update. baseRevision: the revision the edit started from (0
   * for a new page). A stale base is a 409 carrying the current page.
   * created: when a new page was first written (imports keep the original).
   */
  async save ({ slug, title, content, tags, baseRevision = 0, actor, created = null }) {
    const cleanTitle = String(title ?? '').trim()
    if (!cleanTitle) throw new WikiError('A page needs a title')
    const text = String(content ?? '').replace(/\r\n/g, '\n')
    const pageSlug = slug || slugForTitle(cleanTitle)
    const pages = await this.all()
    const current = pages.get(pageSlug)
    const base = Number(baseRevision) || 0
    if ((current?.revision ?? 0) !== base) {
      throw new WikiError(current
        ? `"${current.title}" was changed since you started editing (now revision ${current.revision}, you started from ${base || 'a new page'}).`
        : 'That page no longer exists.', 409, { current })
    }
    const at = this.now().toISOString()
    const n = (current?.revision ?? 0) + 1
    const page = {
      slug: pageSlug,
      iri: pageIri(pageSlug),
      title: cleanTitle,
      content: text,
      created: current?.created ?? (created && !Number.isNaN(Date.parse(created)) ? new Date(created).toISOString() : at),
      modified: current ? at : null,
      revision: n,
      tags: tags === undefined ? (current?.tags ?? []) : cleanTags(tags)
    }
    const graph = await this.graph()
    await this.repository.add({ graph, subject: revisionIri(pageSlug, n), triples: revisionTriples({ slug: pageSlug, page: page.iri, n, title: cleanTitle, content: text, at, actor }), actor, summary: `revision ${n} of ${cleanTitle}` })
    await this.repository.replace({ graph, subject: page.iri, predicates: PAGE_PREDICATES, triples: pageTriples(page), actor, summary: current ? `edit (r${n})` : 'new page' })
    pages.set(pageSlug, page)
    return page
  }

  /** The page and its revisions as Turtle, straight from the store. */
  async turtle (page) {
    return this.client.construct(this.queries.get('wiki/describe-page', { graph: iri(await this.graph()), page: iri(page.iri) }))
  }

  async revisions (page) {
    const rows = await this.client.select(this.queries.get('wiki/revisions', { graph: iri(await this.graph()), page: iri(page.iri) }))
    return rows.map(r => ({ n: Number(r.n), iri: r.revision, title: r.title, created: r.created ?? null, actor: r.actor ?? null }))
  }

  async revision (page, n) {
    const [row] = await this.client.select(this.queries.get('wiki/revision', { graph: iri(await this.graph()), revision: iri(revisionIri(page.slug, n)) }))
    return row ? { n: Number(row.n), title: row.title, content: row.content, created: row.created ?? null, actor: row.actor ?? null } : null
  }

  /** Delete a page, all its revisions, and links to or from it. */
  async delete (page, actor) {
    const revisions = await this.revisions(page)
    await this.repository.deleteResources({ graph: await this.graph(), subjects: [page.iri, ...revisions.map(r => r.iri)], actor, summary: `deleted page ${page.title}` })
    if (this.links) await this.links.forget([page.iri])
    ;(await this.all()).delete(page.slug)
  }
}

export default WikiStore
