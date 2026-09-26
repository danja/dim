import { RETRIEVAL_CONFIG } from '../../../config/preferences.js'
import QueryService from '../store/QueryService.js'
import GraphRegistry from '../store/GraphRegistry.js'
import LexicalIndex, { tokenise } from './LexicalIndex.js'

export { tokenise }

/**
 * Hybrid retrieval: lexical + vector + facet filter. Adapted from
 * plugin-universe SearchService.
 *
 * Facet-agnostic: an adapter supplies what is specific to one document type.
 *
 *   {
 *     id,                                 // e.g. 'bookmark'
 *     queries: { textView, filter, facets, count },  // QueryService names
 *     subject,                            // SPARQL variable holding the IRI
 *     facetNames,                         // filter keys the adapter accepts
 *     toDocument (row, provenance),       // text-view row → document
 *     filterConditions (facets),          // → SPARQL patterns ([] = none)
 *     documentFilter (facets),            // optional: in-memory predicate | null
 *     documentFacets (documents)          // optional: { facet: [{ value, count }] }
 *   }
 *
 * The optional pair covers facets derived in code rather than stored.
 *
 * A document needs at least { iri, name }; LexicalIndex reads the rest.
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
  constructor ({ client, index, embeddings, adapter, queries = new QueryService(), registry = null }) {
    for (const [key, value] of Object.entries({ client, index, embeddings, adapter })) {
      if (!value) throw new SearchError(`SearchService needs ${key}`)
    }
    this.client = client
    this.index = index
    this.embeddings = embeddings
    this.adapter = adapter
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

    const rows = await this.client.select(this.queries.get(this.adapter.queries.textView, {}))
    const subject = this.adapter.subject
    this.documents = new Map(rows.map(row => [
      row[subject],
      this.adapter.toDocument(row, this.sources.get(row.g) ?? null)
    ]))
    this.lexical.build(this.documents.values())
    return this.documents.size
  }

  lexicalScore (queryTokens, doc) {
    return this.lexical.score(queryTokens, doc)
  }

  async #filterSet (facets) {
    const conditions = this.adapter.filterConditions(facets)
    if (conditions.length === 0) return null
    const rows = await this.client.select(this.queries.get(this.adapter.queries.filter, {
      conditions: conditions.join('\n    ')
    }))
    return new Set(rows.map(row => row[this.adapter.subject]))
  }

  #documentFilter (facets) {
    return this.adapter.documentFilter?.(facets) ?? null
  }

  async search (queryText, { facets = {}, limit = RETRIEVAL_CONFIG.defaultPageSize } = {}) {
    if (typeof queryText !== 'string') {
      throw new SearchError('Search needs query text; use facets alone via browse()')
    }
    const pageSize = Math.min(limit, RETRIEVAL_CONFIG.maxPageSize)
    const allowed = await this.#filterSet(facets)
    const keep = this.#documentFilter(facets)
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
    for (const [docIri, doc] of this.documents) {
      if (allowed && !allowed.has(docIri)) continue
      if (keep && !keep(doc)) continue
      const lexical = this.lexicalScore(queryTokens, doc)
      const vector = vectorScores.get(docIri) ?? 0
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
    const keep = this.#documentFilter(facets)
    const results = [...this.documents.values()]
      .filter(doc => !allowed || allowed.has(doc.iri))
      .filter(doc => !keep || keep(doc))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { results: results.slice(0, limit), total: results.length }
  }

  async facets () {
    const rows = await this.client.select(this.queries.get(this.adapter.queries.facets, {}))
    const grouped = {}
    for (const row of rows) {
      grouped[row.facet] ??= []
      grouped[row.facet].push({ value: row.value, count: Number(row.count) })
    }
    return { ...grouped, ...(this.adapter.documentFacets?.(this.documents.values()) ?? {}) }
  }

  async count () {
    const [row] = await this.client.select(this.queries.get(this.adapter.queries.count, {}))
    return Number(row?.count ?? 0)
  }
}

export default SearchService
