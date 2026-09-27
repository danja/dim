#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import GraphWriter from '../src/common/store/GraphWriter.js'
import QueryService from '../src/common/store/QueryService.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import { buildApp } from '../src/app.js'
import { buildTopics, DEFAULTS } from '../src/common/topics/buildTopics.js'
import { assignByText } from '../src/common/topics/assignByText.js'
import { topicTriples, TOPIC_SCHEME } from '../src/common/topics/topicTriples.js'

/**
 * Topics: a SKOS scheme derived from what enrichment and the sites said
 * about bookmarks (keywords, GitHub topics, arXiv categories, tags), then
 * given to everything else — wiki pages, tasks, outline items, published
 * posts, recent news — by their names appearing in the text. Replaces
 * graph:alignment/topics.
 *
 *   node bin/topics.js --dry-run          show what it would make
 *   node bin/topics.js                    write it (then restart the server)
 *   options: --min-docs 8 --max-share 0.25 --max-topics 80 --per-bookmark 3 [--all]
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

let app
try {
  app = await buildApp({ config: Config.load(), projectRoot: Config.projectRoot })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { client, facets } = app
const queries = new QueryService()

// 1. The scheme, from bookmark terms.
const byBookmark = new Map()
const rows = await client.select(queries.get('bookmark/topic-terms', {}))
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

// 2. Everything else gets topics by name.
const perFacet = {}
for (const facet of facets) {
  if (facet.id === 'gnamgnam' || typeof facet.documents !== 'function') continue
  const assigned = assignByText(await facet.documents(), result.topics)
  for (const [iri, keys] of assigned) result.assignments.set(iri, keys)
  if (assigned.size) perFacet[facet.label] = assigned.size
}
console.log(`Also given topics: ${Object.entries(perFacet).map(([f, n]) => `${n} in ${f}`).join(', ') || 'nothing else'}`)
if (args.includes('--dry-run')) process.exit(0)

const groups = topicTriples(result)
const report = await (await ShapeValidator.load()).validateTriples(groups.flat())
if (!report.conforms) {
  console.error(`The topics do not conform: ${report.results[0].message}`)
  process.exit(1)
}
const registry = new GraphRegistry(client)
await registry.drop('alignment', 'topics')
const graph = await registry.register({ kind: 'alignment', id: 'topics', licence: 'CC0-1.0', derivedFrom: TOPIC_SCHEME, comment: 'SKOS topics, derived from bookmark keywords, GitHub topics, arXiv categories and tags; given to other resources by name (bin/topics.js)' })
const written = await new GraphWriter(client, { registry }).writeGrouped(graph, groups)
console.log(`Wrote ${written} triples to ${graph}. Restart the server: /topics, and GnamGnam's Topic filter.`)
process.exit(0)
