import logger from 'loglevel'
import GraphRegistry from '../store/GraphRegistry.js'
import QueryService from '../store/QueryService.js'
import URIMinter from '../rdf/URIMinter.js'
import { insertDataQuery } from '../store/SPARQLHelper.js'
import { serialiseBookmark, serialiseBookmarkTypeScheme } from './BookmarkSerialiser.js'
import { parseTurtleFile } from './TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal } from '../store/SPARQLHelper.js'

/**
 * Ingest pipeline for bookmarks. Adapted from plugin-universe IngestPipeline:
 * register graph → drop → write grouped (one bookmark per group so nothing is
 * split across INSERTs) → optional SHACL validation before write.
 */

export class IngestError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'IngestError'
    if (cause) this.cause = cause
  }
}

const BATCH_SIZE = 500

export class IngestPipeline {
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
    queries = new QueryService()
  } = {}) {
    if (!client) throw new IngestError('IngestPipeline needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.validator = validator
    this.queries = queries
  }

  async #writeGrouped (graph, groups) {
    let batch = []
    let written = 0
    const flush = async () => {
      if (batch.length === 0) return
      await this.client.update(insertDataQuery(graph, batch))
      written += batch.length
      batch = []
    }
    for (const group of groups) {
      if (batch.length > 0 && batch.length + group.length > BATCH_SIZE) await flush()
      batch.push(...group)
      if (batch.length >= BATCH_SIZE) await flush()
    }
    await flush()
    return written
  }

  async run (harvester) {
    const started = Date.now()
    const runId = `${harvester.id}-${new Date().toISOString()}`

    const { bookmarks, rejected } = await harvester.harvest()
    if (bookmarks.length === 0 && rejected.length > 0) {
      throw new IngestError(
        `Harvester ${harvester.id} produced no usable records from ${rejected.length} candidates. ` +
        'Refusing to drop the existing graph for an empty result.'
      )
    }

    await this.registry.drop(harvester.kind, harvester.id)
    const graph = await this.registry.register({
      kind: harvester.kind,
      id: harvester.id,
      licence: harvester.licence,
      derivedFrom: harvester.derivedFrom,
      runId
    })

    const groups = []
    const minted = []
    const types = new Set()
    const seen = new Map()
    const collisions = []

    for (const bookmark of bookmarks) {
      let bookmarkIri
      try {
        bookmarkIri = this.minter.mintBookmark({ url: bookmark.url })
      } catch (error) {
        rejected.push({ name: bookmark.url, reason: error.message })
        continue
      }
      // Same URL → same IRI by construction; a second occurrence is a duplicate
      // link, not a collision. Keep the first, merge contexts implicitly.
      if (seen.has(bookmarkIri)) continue
      seen.set(bookmarkIri, bookmark)

      minted.push({ iri: bookmarkIri, bookmark })
      groups.push(serialiseBookmark(bookmark, bookmarkIri))
      for (const t of bookmark.bookmarkTypes) types.add(t.replace(/^.*\//, ''))
    }

    if (this.validator) {
      const report = await this.validator.validateTriples(groups.flat())
      if (!report.conforms) {
        throw new IngestError(
          `Harvester ${harvester.id} produced ${report.results.length} SHACL violations. ` +
          `First: ${report.results[0].message} at ${report.results[0].focusNode} ` +
          `(${report.results[0].path ?? 'no path'})`
        )
      }
    }

    const written = await this.#writeGrouped(graph, groups)
    logger.info(`[ingest] ${harvester.id}: ${minted.length} bookmarks, ${written} triples`)

    return {
      source: harvester.id,
      graph,
      runId,
      licence: harvester.licence,
      bookmarks: minted,
      bookmarkCount: minted.length,
      tripleCount: written,
      bookmarkTypes: [...types],
      rejected,
      collisions,
      elapsedMs: Date.now() - started
    }
  }

  async storedBookmarkTypes () {
    const rows = await this.client.select(this.queries.get('bookmark/bookmark-types', {}))
    const prefix = `${NAMESPACES.dim}concept/`
    return rows
      .map(row => row.bookmarkType)
      .filter(t => t.startsWith(prefix))
      .map(t => t.slice(prefix.length))
  }

  async writeBookmarkTypeScheme (types) {
    await this.registry.drop('alignment', 'bookmark-types')
    const graph = await this.registry.register({
      kind: 'alignment',
      id: 'bookmark-types',
      licence: 'CC0-1.0',
      derivedFrom: `${NAMESPACES.dim}bookmark-types`,
      comment: 'SKOS concept scheme for bookmark types, derived from first-pass retrieval'
    })
    const triples = serialiseBookmarkTypeScheme([...types].sort())
    const written = await this.#writeGrouped(graph, triples.map(triple => [triple]))
    return { graph, tripleCount: written }
  }

  async writeTurtleFile (file, { kind, id, licence, derivedFrom, comment = null }) {
    const dataset = await parseTurtleFile(file)
    const bySubject = new Map()
    for (const quad of dataset) {
      const key = quad.subject.value
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key).push(`${termToSparql(quad.subject)} ${termToSparql(quad.predicate)} ${termToSparql(quad.object)} .`)
    }
    await this.registry.drop(kind, id)
    const graph = await this.registry.register({ kind, id, licence, derivedFrom, comment })
    const written = await this.#writeGrouped(graph, [...bySubject.values()])
    return { graph, tripleCount: written }
  }
}

function termToSparql (term) {
  if (term.termType === 'NamedNode') return iri(term.value)
  if (term.termType === 'BlankNode') return `_:${term.value}`
  if (term.termType === 'Literal') {
    if (term.language) return `${literal(term.value)}@${term.language}`
    if (term.datatype && term.datatype.value !== `${NAMESPACES.xsd}string`) {
      return `${literal(term.value)}^^${iri(term.datatype.value)}`
    }
    return literal(term.value)
  }
  throw new IngestError(`Cannot write a ${term.termType} term`)
}

export default IngestPipeline
