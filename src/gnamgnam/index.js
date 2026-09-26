import { registerRoutes } from './api/routes.js'

/**
 * GnamGnam — the bookmark manager/retriever facet. See
 * src/common/facets/FacetRegistry.js for the facet contract.
 */
export function createGnamgnamFacet ({ search }) {
  if (!search) throw new Error('GnamGnam needs a SearchService')
  return {
    id: 'gnamgnam',
    label: 'GnamGnam',
    description: 'Bookmarks: hybrid lexical + semantic search over saved links.',
    routes (router, { tabs }) {
      registerRoutes(router, { search, tabs })
    },
    health () {
      return { status: 'ok', bookmarks: search.documents.size, index: search.index.size }
    }
  }
}

export default createGnamgnamFacet
