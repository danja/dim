import { iri, literal } from '../common/store/SPARQLHelper.js'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { catalogueFromRow } from './Catalogue.js'
import { linkStatus, LINK_STATUSES } from './LinkStatus.js'

/**
 * Search adapter for bookmarks: tells the facet-agnostic SearchService
 * which queries to run and how to turn a text-view row into a document.
 * See src/common/search/SearchService.js for the adapter contract.
 */

function list (value) {
  return value ? value.split(', ').filter(Boolean) : []
}

function int (value) {
  const n = Number(value)
  return value === undefined || value === null || value === '' || !Number.isFinite(n) ? null : n
}

export const bookmarkSearchAdapter = Object.freeze({
  id: 'bookmark',
  queries: {
    textView: 'bookmark/text-view',
    filter: 'bookmark/filter',
    facets: 'bookmark/facets',
    count: 'bookmark/count'
  },
  /** Variable bound to the document IRI in the text-view and filter queries. */
  subject: 'bookmark',
  facetNames: ['bookmarkType', 'domain', 'linkStatus'],

  toDocument (row, provenance) {
    const bookmarkTypes = list(row.bookmarkTypes)
    const catalogue = catalogueFromRow(row)
    const httpStatus = int(row.httpStatus)
    const fetchStatus = int(row.fetchStatus)
    return {
      iri: row.bookmark,
      graph: row.g ?? null,
      url: row.url,
      linkText: row.linkText ?? null,
      name: row.linkText ?? row.title ?? row.url,
      title: row.title ?? null,
      description: row.description ?? null,
      summary: row.summary ?? null,
      markdown: row.summaryMarkdown ?? null,
      keywords: list(row.keywords),
      domain: row.domain ?? null,
      contentType: row.contentType ?? null,
      httpStatus,
      fetchStatus,
      linkStatus: linkStatus({ httpStatus, fetchStatus }),
      archivedAt: row.archivedAt ?? null,
      context: row.context ?? null,
      sourceLine: int(row.sourceLine),
      catalogue,
      provenance,
      bookmarkTypes,
      // LexicalIndex fields: authors score like a vendor name; types, topics,
      // categories and language as body text.
      vendor: (catalogue.arxivAuthor ?? []).join(' '),
      roles: bookmarkTypes,
      categories: [
        ...bookmarkTypes,
        ...(catalogue.githubTopic ?? []),
        ...(catalogue.arxivCategory ?? []),
        ...(catalogue.githubLanguage ? [catalogue.githubLanguage] : [])
      ],
      formats: [],
      tags: list(row.tags),
      parameters: []
    }
  },

  /** SPARQL triple patterns restricting ?bookmark, or [] for no filter. */
  filterConditions ({ bookmarkType, domain } = {}) {
    const conditions = []
    if (bookmarkType) conditions.push(`?bookmark ${iri(NAMESPACES.dim + 'bookmarkType')} ${iri(NAMESPACES.dim + 'concept/' + bookmarkType)} .`)
    if (domain) conditions.push(`?bookmark ${iri(NAMESPACES.dim + 'domain')} ${literal(domain)} .`)
    return conditions
  },

  /** Filters on derived fields, applied in memory. → predicate or null. */
  documentFilter ({ linkStatus: wanted } = {}) {
    if (!wanted) return null
    return doc => doc.linkStatus === wanted
  },

  /** Facet counts for derived fields, in the same shape as the SPARQL facets. */
  documentFacets (documents) {
    const counts = new Map(LINK_STATUSES.map(s => [s, 0]))
    for (const doc of documents) counts.set(doc.linkStatus, (counts.get(doc.linkStatus) ?? 0) + 1)
    return {
      linkStatus: [...counts]
        .filter(([, count]) => count > 0)
        .map(([value, count]) => ({ value, count }))
    }
  }
})

export default bookmarkSearchAdapter
