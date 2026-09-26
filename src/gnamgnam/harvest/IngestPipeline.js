import logger from 'loglevel'
import GraphRegistry from '../../common/store/GraphRegistry.js'
import QueryService from '../../common/store/QueryService.js'
import URIMinter from '../../common/rdf/URIMinter.js'
import GraphWriter from '../../common/store/GraphWriter.js'
import { serialiseBookmark, serialiseBookmarkTypeScheme } from './BookmarkSerialiser.js'
import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'

/**
 * Ingest pipeline for bookmarks. Adapted from plugin-universe IngestPipeline:
 * register graph → drop → write grouped (one bookmark per group so nothing is
 * split across INSERTs) → optional SHACL validation before write. Batched
 * writing lives in common/store/GraphWriter.js.
 */

export class IngestError extends Error {
  constructor (message, { cause = null } = {}) {
    super(message)
    this.name = 'IngestError'
    if (cause) this.cause = cause
  }
}

export class IngestPipeline {
  constructor (client, {
    registry = new GraphRegistry(client),
    minter = new URIMinter(),
    validator = null,
    queries = new QueryService(),
    writer = new GraphWriter(client, { registry })
  } = {}) {
    if (!client) throw new IngestError('IngestPipeline needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.minter = minter
    this.validator = validator
    this.queries = queries
    this.writer = writer
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

    const written = await this.writer.writeGrouped(graph, groups)
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
    const written = await this.writer.writeGrouped(graph, triples.map(triple => [triple]))
    return { graph, tripleCount: written }
  }

  /** Delegates to GraphWriter; kept so bin/ingest.js reads unchanged. */
  async writeTurtleFile (file, options) {
    return this.writer.writeTurtleFile(file, options)
  }
}

export default IngestPipeline
