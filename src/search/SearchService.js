import { RETRIEVAL_CONFIG } from '../../config/preferences.js'
import { iri } from '../store/SPARQLHelper.js'
import QueryService from '../store/QueryService.js'
import GraphRegistry from '../store/GraphRegistry.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import LexicalIndex, { tokenise } from './LexicalIndex.js'

export { tokenise }

/**
 * Hybrid retrieval over bookmarks: lexical + vector + facet filter.
 * Adapted from plugin-universe SearchService (plugin → bookmark).
 */

export class SearchError extends Error {
  constructor (message) {
    super(message)
    this.name = 'SearchError'
  }
}

export function fuse (lexical, vector) {
  return lexical * RETRIEVAL_CONFIG.lexicalWeight + vector * RETRIEVAL_CONFIG.vectorWeight
}

export class SearchService {
  constructor ({ client, index, embeddings, queries = new QueryService(), registry = null }) {
    for (const [key, value] of Object.entries({ client, index, embeddings })) {
      if (!value) throw new SearchError(`SearchService needs ${key}`)
    }
    this.client = client
    this.index = index
    this.embeddings = embeddings
    this.queries = queries
    this.registry = registry ?? new GraphRegistry(client)
    this.documents = new Map()
    this.sources = new Map()
    this.lexical = new LexicalIndex()
  }

  async loadDocuments () {
    this.sources = new Map()
    for (const row of await this.registry.list()) {
      this.sources.set(row.graph, {
        graph: row.graph,
        source: row.identifier ?? row.graph,
        licence: row.licence ?? null,
        derivedFrom: row.derivedFrom ?? null
      })
    }

    const rows = await this.client.select(this.queries.get('bookmark/text-view', {}))
    this.documents = new Map(rows.map(row => [row.bookmark, {
      iri: row.bookmark,
      url: row.url,
      linkText: row.linkText ?? null,
      name: row.linkText ?? row.title ?? row.url,
      title: row.title ?? null,
      description: row.description ?? null,
      summary: row.summary ?? null,
      markdown: row.summaryMarkdown ?? null,
      keywords: row.keywords ? row.keywords.split(', ').filter(Boolean) : [],
      domain: row.domain ?? null,
      contentType: row.contentType ?? null,
      httpStatus: row.httpStatus ?? null,
      provenance: this.sources.get(row.g) ?? null,
      bookmarkTypes: row.bookmarkTypes ? row.bookmarkTypes.split(', ').filter(Boolean) : [],
      // LexicalIndex expects these fields; map bookmark types into roles/categories/tags.
      roles: row.bookmarkTypes ? row.bookmarkTypes.split(', ').filter(Boolean) : [],
      categories: row.bookmarkTypes ? row.bookmarkTypes.split(', ').filter(Boolean) : [],
      formats: [],
      tags: row.tags ? row.tags.split(', ').filter(Boolean) : [],
      parameters: []
    }]))
    this.lexical.build(this.documents.values())
    return this.documents.size
  }

  lexicalScore (queryTokens, doc) {
    return this.lexical.score(queryTokens, doc)
  }

  #filterConditions ({ bookmarkType, domain }) {
    const conditions = []
    if (bookmarkType) conditions.push(`?bookmark ${iri(NAMESPACES.dim + 'bookmarkType')} ${iri(NAMESPACES.dim + 'concept/' + bookmarkType)} .`)
    if (domain) conditions.push(`?bookmark ${iri(NAMESPACES.dim + 'domain')} "${domain.replace(/"/g, '')}" .`)
    return conditions.length ? conditions.join('\n    ') : null
  }

  async #filterSet (facets) {
    const conditions = this.#filterConditions(facets)
    if (!conditions) return null
    const rows = await this.client.select(this.queries.get('bookmark/filter', { conditions }))
    return new Set(rows.map(row => row.bookmark))
  }

  async search (queryText, { facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize } = {}) {
    if (typeof queryText !== 'string') {
      throw new SearchError('Search needs query text; use facets alone via browse()')
    }
    const pageSize = Math.min(limit, RETRIEVAL_CONFIG.maxPageSize)
    const allowed = await this.#filterSet(facets)
    const queryTokens = tokenise(queryText)

    const vectorScores = new Map()
    if (queryText.trim() !== '' && this.index.size > 0) {
      const vector = await this.embeddings.embed(queryText)
      const hits = this.index.search(vector, RETRIEVAL_CONFIG.candidateLimit, {
        minScore: RETRIEVAL_CONFIG.minSimilarity
      })
      for (const hit of hits) vectorScores.set(hit.iri, hit.score)
    }

    const fused = []
    for (const [bookmarkIri, doc] of this.documents) {
      if (allowed && !allowed.has(bookmarkIri)) continue
      const lexical = this.lexicalScore(queryTokens, doc)
      const vector = vectorScores.get(bookmarkIri) ?? 0
      if (lexical === 0 && vector === 0) continue
      fused.push({ ...doc, score: fuse(lexical, vector), signals: { lexical, vector } })
    }

    fused.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    return {
      results: fused.slice(0, pageSize),
      total: fused.length,
      signals: {
        vectorCandidates: vectorScores.size,
        filtered: allowed ? allowed.size : null,
        corpus: this.documents.size
      }
    }
  }

  async browse ({ facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize } = {}) {
    const allowed = await this.#filterSet(facets)
    const results = [...this.documents.values()]
      .filter(doc => !allowed || allowed.has(doc.iri))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { results: results.slice(0, limit), total: results.length }
  }

  async facets () {
    const rows = await this.client.select(this.queries.get('bookmark/facets', {}))
    const grouped = {}
    for (const row of rows) {
      grouped[row.facet] ??= []
      grouped[row.facet].push({ value: row.value, count: Number(row.count) })
    }
    return grouped
  }

  async count () {
    const [row] = await this.client.select(this.queries.get('bookmark/count', {}))
    return Number(row?.count ?? 0)
  }
}

export default SearchService
