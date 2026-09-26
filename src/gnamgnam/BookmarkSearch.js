import { iri, literal } from '../common/store/SPARQLHelper.js'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'

/**
 * Search adapter for bookmarks: tells the facet-agnostic SearchService
 * which queries to run and how to turn a text-view row into a document.
 * See src/common/search/SearchService.js for the adapter contract.
 */

function list (value) {
  return value ? value.split(', ').filter(Boolean) : []
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
  facetNames: ['bookmarkType', 'domain'],

  toDocument (row, provenance) {
    const bookmarkTypes = list(row.bookmarkTypes)
    return {
      iri: row.bookmark,
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
      httpStatus: row.httpStatus ?? null,
      provenance,
      bookmarkTypes,
      // LexicalIndex scores roles/categories/tags as body text.
      roles: bookmarkTypes,
      categories: bookmarkTypes,
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
  }
})

export default bookmarkSearchAdapter
