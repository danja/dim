#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import GraphWriter from '../src/common/store/GraphWriter.js'
import QueryService from '../src/common/store/QueryService.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import { buildTopics, DEFAULTS } from '../src/gnamgnam/topics/buildTopics.js'
import { topicTriples, TOPIC_SCHEME } from '../src/gnamgnam/topics/topicTriples.js'

/**
 * Derive bookmark topics (a SKOS scheme) from enrichment keywords, GitHub
 * topics, arXiv categories and tags, and tag each bookmark with its most
 * specific ones. Replaces graph:alignment/bookmark-topics.
 *
 *   node bin/topics.js --dry-run          show what it would make
 *   node bin/topics.js                    write it (then restart the server)
 *   options: --min-docs 8 --max-share 0.25 --max-topics 80 --per-bookmark 3
 *
 * Run it after enrichment has added keywords (bin/enrich.js); re-run
 * whenever you like — it is rebuilt from scratch each time.
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const num = (name, fallback) => {
  const i = args.indexOf(name)
  return i === -1 ? fallback : Number(args[i + 1])
}
const options = {
  minDocs: num('--min-docs', DEFAULTS.minDocs),
  maxShare: num('--max-share', DEFAULTS.maxShare),
  maxTopics: num('--max-topics', DEFAULTS.maxTopics),
  perBookmark: num('--per-bookmark', DEFAULTS.perBookmark)
}

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}
const queries = new QueryService()
const rows = await client.select(queries.get('bookmark/topic-terms', {}))
const byBookmark = new Map()
for (const r of rows) {
  if (!byBookmark.has(r.bookmark)) byBookmark.set(r.bookmark, [])
  byBookmark.get(r.bookmark).push(r.term)
}
const [{ count }] = await client.select(queries.get('bookmark/count', {}))
const docs = [...byBookmark].map(([iri, terms]) => ({ iri, terms }))
// Domains have their own filter; the source's tags often repeat them.
const domains = (await client.select(queries.get('bookmark/domains', {}))).map(r => r.d)
const result = buildTopics(docs, { ...options, total: Number(count), exclude: domains })

const tagged = result.assignments.size
console.log(`${Number(count)} bookmarks, ${docs.length} with terms (${rows.length} terms) → ${result.topics.length} topics; ${tagged} bookmarks tagged (${Math.round(100 * tagged / Math.max(1, Number(count)))}%)`)
const bySize = [...result.topics].sort((a, b) => b.size - a.size)
for (const t of bySize.slice(0, args.includes('--all') ? Infinity : 40)) {
  const parent = t.broader ? result.topics.find(x => x.key === t.broader).label : ''
  console.log(`  ${String(t.size).padStart(4)}  ${t.label}${parent ? `  ⊂ ${parent}` : ''}${t.altLabels.length ? `  (also: ${t.altLabels.join(', ')})` : ''}`)
}
if (!result.topics.length) {
  console.log(docs.length ? 'No term is shared by enough bookmarks: lower --min-docs.' : 'No keywords yet: run bin/enrich.js first (topics come mostly from its keywords).')
  process.exit(0)
}
if (args.includes('--dry-run')) process.exit(0)

const groups = topicTriples(result)
const report = await (await ShapeValidator.load()).validateTriples(groups.flat())
if (!report.conforms) {
  console.error(`The topics do not conform: ${report.results[0].message}`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
await registry.drop('alignment', 'bookmark-topics')
const graph = await registry.register({ kind: 'alignment', id: 'bookmark-topics', licence: 'CC0-1.0', derivedFrom: TOPIC_SCHEME, comment: 'SKOS topics for bookmarks, derived from keywords, GitHub topics, arXiv categories and tags (bin/topics.js)' })
const written = await new GraphWriter(client, { registry }).writeGrouped(graph, groups)
console.log(`Wrote ${written} triples to ${graph}. Restart the server; GnamGnam then offers a Topic filter.`)
