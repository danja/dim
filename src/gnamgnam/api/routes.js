import { RETRIEVAL_CONFIG } from '../../../config/preferences.js'
import { send, sendText, sendHtml, LICENCE } from '../../common/http/respond.js'
import { negotiate } from '../../common/http/negotiate.js'
import { BOOKMARK_PREFIX, bookmarkDataUrl, savedTurtle } from './bookmarkData.js'
import { renderSearchPage } from './searchPage.js'

/** GnamGnam HTTP routes: search page, search/facets/browse JSON, one bookmark. */

function facetParams (params) {
  return {
    bookmarkType: params.get('bookmarkType') || params.get('type') || null,
    domain: params.get('domain') || null
  }
}

function pageSize (params, fallback) {
  return Math.min(Number(params.get('limit')) || fallback, RETRIEVAL_CONFIG.maxPageSize)
}

export function registerRoutes (router, { search }) {
  router.get('/', async ({ response, url, started }) => {
    const q = url.searchParams.get('q')
    const facets = facetParams(url.searchParams)
    const hasCriteria = Boolean(q) || Object.values(facets).some(Boolean)
    const outcome = hasCriteria
      ? (q ? await search.search(q, { facets, limit: 25 }) : await search.browse({ facets, limit: 25 }))
      : { results: [], total: 0 }
    return sendHtml(response, 200, renderSearchPage({
      query: q,
      results: outcome.results,
      total: outcome.total,
      corpus: search.documents.size,
      elapsedMs: hasCriteria ? Date.now() - started : undefined,
      facetValues: await search.facets()
    }))
  })

  router.get('/search', async ({ response, url, started }) => {
    const q = url.searchParams.get('q')
    const facets = facetParams(url.searchParams)
    const limit = pageSize(url.searchParams, RETRIEVAL_CONFIG.defaultPageSize)
    if (!q && !Object.values(facets).some(Boolean)) {
      return send(response, 400, { error: 'Provide q, or at least one of bookmarkType, domain' })
    }
    const outcome = q
      ? await search.search(q, { facets, limit })
      : await search.browse({ facets, limit })
    return send(response, 200, {
      query: q ?? null,
      facets: Object.fromEntries(Object.entries(facets).filter(([, v]) => v)),
      total: outcome.total,
      count: outcome.results.length,
      elapsedMs: Date.now() - started,
      results: outcome.results.map(r => ({ ...r, data: bookmarkDataUrl(r) })),
      signals: outcome.signals ?? null,
      licence: LICENCE
    })
  })

  router.get('/facets', async ({ response }) => {
    return send(response, 200, { facets: await search.facets(), licence: LICENCE })
  })

  router.get('/bookmarks', async ({ response, url }) => {
    const outcome = await search.browse({ limit: pageSize(url.searchParams, 50) })
    return send(response, 200, { total: outcome.total, results: outcome.results, licence: LICENCE })
  })

  router.get(/^\/bookmark\/([A-Za-z0-9-]+?)(\.ttl|\.json)?$/, async ({ request, response, match }) => {
    const bookmarkIri = `${BOOKMARK_PREFIX}${match[1]}`
    const doc = search.documents.get(bookmarkIri)
    if (!doc) return send(response, 404, { error: 'No such bookmark', iri: bookmarkIri })
    if (negotiate(match[2], request.headers.accept) === 'turtle') {
      return sendText(response, 200, await savedTurtle(search, bookmarkIri, doc), 'text/turtle; charset=utf-8')
    }
    return send(response, 200, { ...doc, data: bookmarkDataUrl(doc), licence: LICENCE })
  })

  return router
}

export default registerRoutes
