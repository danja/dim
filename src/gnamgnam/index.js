import { registerRoutes } from './api/routes.js'
import { BASE_PATH, bookmarkSlug } from './api/bookmarkData.js'
import { canonicalUrl } from '../common/rdf/URIMinter.js'

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
