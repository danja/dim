import { registerRoutes } from './api/routes.js'
import { BASE_PATH, bookmarkSlug } from './api/bookmarkData.js'
import { canonicalUrl } from '../common/rdf/URIMinter.js'
import { hostOf } from '../common/links/urls.js'

/**
 * GnamGnam — the bookmark manager/retriever facet. See
 * src/common/facets/FacetRegistry.js for the facet contract.
 */

function snippet (doc) {
  const text = doc.summary || doc.description || doc.domain || ''
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

function canonical (url) {
  try { return canonicalUrl(url) } catch { return null }
}

export function createGnamgnamFacet ({ search }) {
  if (!search) throw new Error('GnamGnam needs a SearchService')

  // url → iri, rebuilt when the document map is replaced (loadDocuments).
  let urlIndex = { documents: null, map: new Map() }
  const byUrl = () => {
    if (urlIndex.documents !== search.documents) {
      const map = new Map()
      for (const doc of search.documents.values()) {
        const key = canonical(doc.url)
        if (key && !map.has(key)) map.set(key, doc.iri)
      }
      urlIndex = { documents: search.documents, map }
    }
    return urlIndex.map
  }

  const href = doc => `${BASE_PATH}/bookmark/${bookmarkSlug(doc.iri)}`

  return {
    id: 'gnamgnam',
    label: 'GnamGnam',
    description: 'Bookmarks: hybrid lexical + semantic search over saved links.',
    types: { bookmark: `${BASE_PATH}/bookmark/` },

    routes (router, ctx) {
      registerRoutes(router, { search, ...ctx })
    },

    health () {
      return { status: 'ok', bookmarks: search.documents.size, index: search.index.size }
    },

    /** Your own tags on bookmarks (the source's tags are mostly domains). */
    tags () {
      const out = new Map()
      for (const doc of search.documents.values()) for (const t of doc.userTags ?? []) out.set(t, (out.get(t) ?? 0) + 1)
      return out
    },

    tagged (tag) {
      return [...search.documents.values()].filter(d => (d.userTags ?? []).includes(tag))
        .map(d => ({ iri: d.iri, label: d.name, href: href(d), snippet: snippet(d) }))
    },

    /** Bookmarks from one site. */
    aboutDomain (host) {
      const docs = [...search.documents.values()].filter(d => hostOf(d.url) === host)
      if (!docs.length) return []
      const domain = docs[0].domain ?? host
      return [{ label: `${docs.length} bookmark${docs.length === 1 ? '' : 's'} from ${host}`, href: `${BASE_PATH}/?domain=${encodeURIComponent(domain)}`, count: docs.length }]
    },

    /** A bookmarked URL's page and last-known link status. */
    urlStatus (url) {
      const key = canonical(url)
      const iri = key ? byUrl().get(key) : null
      const doc = iri ? search.documents.get(iri) : null
      return doc ? { iri, href: href(doc), label: doc.name, status: doc.linkStatus, archivedAt: doc.archivedAt ?? null } : null
    },

    /** A bookmark was written elsewhere (e.g. saved from News): load it now. */
    async refresh (resourceIri) {
      return search.loadDocument?.(resourceIri) ?? null
    },

    lookup (resourceIri) {
      const doc = search.documents.get(resourceIri)
      return doc ? { label: doc.name, href: href(doc), type: 'bookmark' } : null
    },

    lookupUrl (url) {
      const key = canonical(url)
      return key ? byUrl().get(key) ?? null : null
    },

    lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      for (const doc of search.documents.values()) {
        if (String(doc.name).toLowerCase() === wanted) return doc.iri
      }
      return null
    },

    async find (q, { limit = 10 } = {}) {
      const { results } = await search.search(q, { limit })
      return results.map(doc => ({ iri: doc.iri, label: doc.name, href: href(doc), snippet: snippet(doc) }))
    }
  }
}

export default createGnamgnamFacet
