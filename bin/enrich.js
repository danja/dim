#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/Config.js'
import SPARQLClient from '../src/store/SPARQLClient.js'
import QueryService from '../src/store/QueryService.js'
import EmbeddingService, { composeText } from '../src/embeddings/EmbeddingService.js'
import VectorIndex from '../src/vectors/VectorIndex.js'
import { createEnricher } from '../src/enrich/registry.js'
import { ENRICH_CONFIG } from '../config/preferences.js'

/**
 * Second-pass enrichment (docs/enricher.md): GET each bookmark target,
 * summarise it, patch the store, optionally re-embed.
 *
 * Usage:
 *   node bin/enrich.js [--limit N] [--only-new] [--force] [--quiet]
 *     [--summariser ollama|extractive] [--reembed]
 *
 * --only-new skips bookmarks that already have dim:summary. --force ignores
 * the enrichment cache. --quiet collapses per-bookmark lines to progress.
 * --reembed re-embeds patched bookmarks into the FAISS index (needs Ollama
 * embedding model). Writes checkpoint the index every
 * ENRICH_CONFIG.checkpointEvery embeds.
 */

logger.setLevel('info')

const args = process.argv.slice(2)
const limitIdx = args.indexOf('--limit')
const limit = limitIdx === -1 ? Infinity : Number(args[limitIdx + 1])
const onlyNew = args.includes('--only-new')
const force = args.includes('--force')
const quiet = args.includes('--quiet')
const reembed = args.includes('--reembed')
const summariserIdx = args.indexOf('--summariser')
const summariser = summariserIdx === -1 ? ENRICH_CONFIG.summariser : args[summariserIdx + 1]
if (!['ollama', 'extractive'].includes(summariser)) {
  console.error(`--summariser must be ollama|extractive, got ${JSON.stringify(summariser)}`)
  process.exit(1)
}

function fmtAge (ms) {
  if (ms < 0 || !Number.isFinite(ms)) return '?'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function fmtEta (ms) {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  const s = Math.round(ms / 1000)
  if (s < 90) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

function shortUrl (url, max = 72) {
  const u = String(url ?? '')
  return u.length > max ? `${u.slice(0, max - 1)}…` : u
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const queries = new QueryService()
const rows = await client.select(queries.get('bookmark/text-view', {}))

let candidates = rows
const alreadySummarised = rows.filter(row => row.summary).length
if (onlyNew) candidates = candidates.filter(row => !row.summary)
candidates = candidates.slice(0, limit)

const enricher = createEnricher(client, {
  summariser,
  ollamaBaseUrl: config.has('enrichment.ollamaBaseUrl') ? config.get('enrichment.ollamaBaseUrl') : undefined
})
const chain = enricher.summarisers.map(s => s.id).join(' → ')
const cache = enricher.cache

console.log(`Store: ${rows.length} bookmarks (${alreadySummarised} already summarised).`)
console.log(`Plan: enriching ${candidates.length} (only-new=${onlyNew}, force=${force}, limit=${limit === Infinity ? 'none' : limit}).`)
console.log(`Summarisers: ${chain}`)
console.log(`Cache: ${cache?.cachePath ?? '(none)'}, TTL ${fmtAge(enricher.cacheTtlMs)}.${reembed ? ' Re-embed on.' : ''}`)

const counts = {}
const enrichedRows = []
const started = Date.now()
let n = 0
for (const row of candidates) {
  n += 1
  const result = await enricher.run({
    iri: row.bookmark,
    graph: row.g,
    url: row.url,
    linkText: row.linkText ?? null,
    bookmarkTypes: row.bookmarkTypes ? row.bookmarkTypes.split(', ').filter(Boolean) : [],
    contentType: row.contentType ?? null
  }, { force })
  counts[result.status] = (counts[result.status] ?? 0) + 1
  if (result.status === 'enriched') enrichedRows.push({ row, enrichment: result.enrichment })

  const elapsed = Date.now() - started
  if (!quiet) console.log(`[${n}/${candidates.length}] ${result.status} ${shortUrl(row.url)}${describeResult(result)}`)
  if (n % 10 === 0 || n === candidates.length) {
    const rate = n / Math.max(elapsed / 1000, 0.001)
    const eta = fmtEta((candidates.length - n) / Math.max(rate, 0.001) * 1000)
    logger.info(`[enrich] ${n}/${candidates.length} ${rate.toFixed(1)}/s ETA ${eta} ${JSON.stringify(counts)}`)
  }
}

function describeResult (result) {
  const e = result.enrichment
  switch (result.status) {
    case 'enriched':
      return ` — ${e?.summaryModel ?? '?'} ${(e?.keywords ?? []).length} keywords, summary ${e?.summary?.length ?? 0}ch from ${e?.contentLength ?? 0}ch, fetch ${e?.fetchStatus ?? '?'}` +
        (e?.markdown ? `, md ${e.markdown.length}ch` : '')
    case 'fresh': {
      const at = e?.summarisedAt ?? e?.cachedAt
      return at ? ` — cached ${fmtAge(Date.now() - new Date(at).getTime())} ago` : ''
    }
    case 'unchanged':
      return ` — same content ${e?.contentHash ?? ''}`
    case 'refused':
      return e?.fetchStatus ? ` — HTTP ${e.fetchStatus}` : ''
    case 'failed':
      return result.error ? ` — ${result.error}` : ''
    default:
      return ''
  }
}

console.log(`\nEnriched ${enrichedRows.length}/${candidates.length} in ${((Date.now() - started) / 1000).toFixed(1)}s: ${JSON.stringify(counts)}`)

if (!reembed) process.exit(0)
if (enrichedRows.length === 0) {
  console.log('Nothing enriched, index untouched.')
  process.exit(0)
}

const embeddings = EmbeddingService.fromConfig(config)
if (!(await embeddings.isAvailable())) {
  console.error(`\nEmbedding model ${config.get('embedding.model')} is not available; index not updated.`)
  process.exit(1)
}
const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})
console.log(`\nRe-embedding ${enrichedRows.length} bookmarks with ${config.get('embedding.model')} (index: ${index.size} vectors at ${index.path}).`)

let done = 0
let failed = 0
const embedStarted = Date.now()
for (const { row, enrichment } of enrichedRows) {
  const bookmark = {
    url: row.url,
    linkText: row.linkText ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
    summary: enrichment.summary ?? null,
    keywords: enrichment.keywords ?? [],
    bookmarkTypes: row.bookmarkTypes ? row.bookmarkTypes.split(', ').filter(Boolean) : [],
    tags: row.tags ? row.tags.split(', ').filter(Boolean) : []
  }
  try {
    const vector = await embeddings.embed(composeText(bookmark))
    index.add(row.bookmark, vector)
  } catch (error) {
    failed += 1
    logger.warn(`[re-embed] ${shortUrl(row.url)} failed: ${error.message}`)
    if (!quiet) console.log(`[re-embed ${done + failed}/${enrichedRows.length}] FAILED ${shortUrl(row.url)} — ${error.message}`)
  }
  done += 1
  if (!quiet && failed === 0) console.log(`[re-embed ${done}/${enrichedRows.length}] ${shortUrl(row.url)}`)
  if (done % 10 === 0 || done === enrichedRows.length) {
    const rate = done / Math.max((Date.now() - embedStarted) / 1000, 0.001)
    logger.info(`[re-embed] ${done}/${enrichedRows.length} ${rate.toFixed(2)}/s failed=${failed}`)
  }
  if (done % ENRICH_CONFIG.checkpointEvery === 0) {
    await index.save()
    logger.info(`[re-embed] checkpoint saved (${done})`)
  }
}
index.compact()
await index.save()
console.log(`\nRe-embedded ${done - failed}/${done} bookmarks in ${((Date.now() - embedStarted) / 1000).toFixed(1)}s (index: ${index.size} vectors, ${failed} failed).`)
console.log('Restart the app so it reloads documents + index.')
