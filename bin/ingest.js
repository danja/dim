#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import IngestPipeline from '../src/harvest/IngestPipeline.js'
import BookmarkHarvester from '../src/harvest/BookmarkHarvester.js'
import ShapeValidator from '../src/store/ShapeValidator.js'
import EmbeddingService from '../src/embeddings/EmbeddingService.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import SearchService from '../src/search/SearchService.js'
import { composeText, textHash } from '../src/embeddings/EmbeddingService.js'

/**
 * Harvest workflowy bookmarks, write them to the store, build the vector index.
 * Adapted from plugin-universe bin/ingest.js.
 *
 * Usage:
 *   node bin/ingest.js [--skip-embeddings] [--skip-validation] [--no-fetch]
 *   node bin/ingest.js --only-new
 *
 * --no-fetch skips live HTTP probing and classifies from URLs alone (fast,
 * offline, deterministic). The default probes each URL once and caches in
 * data/cache/retrieval.json for 7 days.
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const skipEmbeddings = args.includes('--skip-embeddings')
const onlyNew = args.includes('--only-new')
const noFetch = args.includes('--no-fetch')
// Bounded runs: --limit N embeds at most N bookmarks. Useful while embedding
// is slow (CPU-only Ollama ≈5s/vector); repeat runs with --only-new converge
// to a full index via the checkpointed file.
const limitIdx = args.indexOf('--limit')
const limit = limitIdx === -1 ? Infinity : Number(args[limitIdx + 1])

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const validator = args.includes('--skip-validation') ? null : await ShapeValidator.load()
const pipeline = new IngestPipeline(client, { validator })

const harvester = new BookmarkHarvester({
  workflowyFile: config.get('sources.workflowy.file'),
  cachePath: config.get('sources.workflowy.cachePath'),
  fetchLive: !noFetch
})

const report = await pipeline.run(harvester)
console.log(`\n${report.source}  →  ${report.graph}`)
console.log(`  licence     ${report.licence}`)
console.log(`  bookmarks   ${report.bookmarkCount}`)
console.log(`  triples     ${report.tripleCount}`)
console.log(`  types       ${report.bookmarkTypes.join(', ')}`)
console.log(`  elapsed     ${report.elapsedMs} ms`)
if (report.rejected.length) {
  console.log(`  rejected    ${report.rejected.length}`)
  for (const item of report.rejected.slice(0, 10)) {
    console.log(`    ${item.name}: ${item.reason}`)
  }
}

const storedTypes = await pipeline.storedBookmarkTypes()
const scheme = await pipeline.writeBookmarkTypeScheme(storedTypes)
console.log(`\ntypes       →  ${scheme.graph}  (${storedTypes.length} concepts, ${scheme.tripleCount} triples)`)

const vocab = await pipeline.writeTurtleFile('vocabs/dim.ttl', {
  kind: 'alignment',
  id: 'vocabularies',
  licence: 'CC0-1.0',
  derivedFrom: `${config.get('baseUri')}vocabularies`,
  comment: 'DIM ontology'
})
console.log(`vocab       →  ${vocab.graph}  (${vocab.tripleCount} triples)`)

if (skipEmbeddings) {
  console.log('\nSkipping embeddings (--skip-embeddings).')
  process.exit(0)
}

const embeddings = EmbeddingService.fromConfig(config)
if (!(await embeddings.isAvailable())) {
  console.error(`\nEmbedding model ${config.get('embedding.model')} is not available; index not built.`)
  process.exit(1)
}

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})

async function unembedded () {
  const search = new SearchService({ client, index, embeddings })
  const total = await search.loadDocuments()
  const missing = [...search.documents.values()]
    .filter(doc => !index.positionByIri.has(doc.iri))
    .map(doc => ({ iri: doc.iri, bookmark: doc }))
  console.log(`\n${total} bookmarks in the store, ${missing.length} without a vector.`)
  return missing
}

const all = (onlyNew ? await unembedded() : report.bookmarks.map(({ iri, bookmark }) => ({ iri, bookmark }))).slice(0, limit)

if (all.length === 0) {
  console.log('Nothing to embed.')
  process.exit(0)
}
console.log(`\nEmbedding ${all.length} bookmarks with ${config.get('embedding.model')}...`)

const CHECKPOINT_EVERY = 100
let embedded = 0
const started = Date.now()
for (const { iri, bookmark } of all) {
  const text = composeText(bookmark)
  const vector = await embeddings.embed(text)
  index.add(iri, vector)
  embedded += 1
  if (embedded % 25 === 0) {
    const rate = (Date.now() - started) / embedded
    const remaining = ((all.length - embedded) * rate / 1000).toFixed(0)
    process.stdout.write(`  ${embedded}/${all.length}  ~${remaining}s remaining   \r`)
  }
  if (embedded % CHECKPOINT_EVERY === 0) await index.save()
}
index.compact()
await index.save()

console.log(`  ${embedded}/${all.length} embedded in ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  index: ${index.size} vectors at ${index.path}`)
console.log(`  text hash of first: ${textHash(composeText(all[0].bookmark))}`)
