import fs from 'fs'
import path from 'path'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../store/SPARQLHelper.js'
import Config from '../Config.js'

/**
 * Pluggable writers for the second-pass enricher (docs/enricher.md).
 *
 * SparqlPatchWriter patches one bookmark's enrichment predicates in place
 * (no graph drop). CacheWriter persists the enrichment cache + raw text to
 * disk so runs resume and unchanged content is skipped.
 */

const dim = NAMESPACES.dim

export const ENRICHMENT_PREDICATES = Object.freeze([
  dim + 'summary',
  dim + 'summaryModel',
  dim + 'summarisedAt',
  dim + 'keyword',
  dim + 'summaryMarkdown',
  dim + 'contentHash',
  dim + 'contentLength',
  dim + 'fetchStatus'
])

export function enrichmentTriples (bookmarkIri, enrichment) {
  const s = iri(bookmarkIri)
  const triples = []
  if (enrichment.summary) triples.push(`${s} ${iri(dim + 'summary')} ${literal(enrichment.summary)} .`)
  if (enrichment.summaryModel) triples.push(`${s} ${iri(dim + 'summaryModel')} ${literal(enrichment.summaryModel)} .`)
  if (enrichment.summarisedAt) triples.push(`${s} ${iri(dim + 'summarisedAt')} ${typedLiteral(new Date(enrichment.summarisedAt))} .`)
  for (const kw of enrichment.keywords ?? []) triples.push(`${s} ${iri(dim + 'keyword')} ${literal(kw)} .`)
  if (enrichment.markdown) triples.push(`${s} ${iri(dim + 'summaryMarkdown')} ${literal(enrichment.markdown)} .`)
  if (enrichment.contentHash) triples.push(`${s} ${iri(dim + 'contentHash')} ${literal(enrichment.contentHash)} .`)
  if (typeof enrichment.contentLength === 'number') triples.push(`${s} ${iri(dim + 'contentLength')} ${typedLiteral(enrichment.contentLength)} .`)
  if (typeof enrichment.fetchStatus === 'number') triples.push(`${s} ${iri(dim + 'fetchStatus')} ${typedLiteral(enrichment.fetchStatus)} .`)
  return triples
}

/** DELETE existing enrichment predicates for the subject, then INSERT. */
export function buildEnrichmentPatchQuery (graph, bookmarkIri, enrichment) {
  const g = iri(graph)
  const s = iri(bookmarkIri)
  const values = ENRICHMENT_PREDICATES.map(p => `( ${iri(p)} )`).join(' ')
  const triples = enrichmentTriples(bookmarkIri, enrichment)
  const insert = triples.length
    ? `INSERT DATA { GRAPH ${g} {\n    ${triples.join('\n    ')}\n  } }`
    : ''
  const del = `DELETE { GRAPH ${g} { ${s} ?enrichPred ?enrichOld } }
WHERE { GRAPH ${g} { ${s} ?enrichPred ?enrichOld VALUES ( ?enrichPred ) { ${values} } } }`
  return insert ? `${del} ;\n${insert}` : del
}

export class SparqlPatchWriter {
  constructor (client) {
    if (!client) throw new Error('SparqlPatchWriter needs a SPARQLClient')
    this.client = client
  }

  async write ({ graph, bookmarkIri, enrichment }) {
    if (!graph || !bookmarkIri || !enrichment) return { patched: false }
    const triples = enrichmentTriples(bookmarkIri, enrichment)
    if (triples.length === 0) return { patched: false }
    await this.client.update(buildEnrichmentPatchQuery(graph, bookmarkIri, enrichment))
    return { patched: true, triples: triples.length }
  }
}

const CACHE_VERSION = 1

/** JSON cache of enrichment entries + raw extracted text files. */
export class CacheWriter {
  constructor ({ cachePath = path.join(Config.projectRoot, 'data/cache/enrichment.json') } = {}) {
    this.cachePath = cachePath
    this.rawDir = path.join(path.dirname(cachePath), 'enrichment')
    this.cache = null
  }

  async #load () {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.promises.readFile(this.cachePath, 'utf8'))
    } catch {
      this.cache = { version: CACHE_VERSION, entries: {} }
    }
    this.cache.entries ??= {}
    return this.cache
  }

  async get (url) {
    const cache = await this.#load()
    return cache.entries[url] ?? null
  }

  async write ({ url, enrichment, rawText = null }) {
    const cache = await this.#load()
    cache.entries[url] = { ...enrichment, url, cachedAt: new Date().toISOString() }
    if (rawText && enrichment.contentHash) {
      await fs.promises.mkdir(this.rawDir, { recursive: true })
      await fs.promises.writeFile(path.join(this.rawDir, `${enrichment.contentHash}.txt`), rawText)
    }
    await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true })
    await fs.promises.writeFile(this.cachePath, JSON.stringify(cache, null, 2))
    return cache.entries[url]
  }

  isFresh (entry, ttlMs) {
    if (!entry?.summarisedAt && !entry?.cachedAt) return false
    const at = new Date(entry.summarisedAt ?? entry.cachedAt).getTime()
    return Date.now() - at < ttlMs
  }
}

export default SparqlPatchWriter
