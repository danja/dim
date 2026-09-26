#!/usr/bin/env node
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import VectorIndex from '../src/common/vectors/VectorIndex.js'
import EmbeddingService from '../src/common/embeddings/EmbeddingService.js'
import SearchService from '../src/common/search/SearchService.js'
import { bookmarkSearchAdapter } from '../src/gnamgnam/BookmarkSearch.js'

/**
 * Search DIM bookmarks from the command line.
 *   node bin/search.js "modular synth DIY"
 *   node bin/search.js "paper" --bookmarkType arxiv-paper
 *   node bin/search.js --facets
 */

const args = process.argv.slice(2)

function parseArgs (argv) {
  const flags = {}
  const words = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      words.push(arg)
      continue
    }
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true
    } else {
      flags[name] = next
      i++
    }
  }
  return { flags, text: words.join(' ') }
}

const { flags, text } = parseArgs(args)
const flag = name => (typeof flags[name] === 'string' ? flags[name] : null)

const config = Config.load()
const client = new SPARQLClient(config.get('storage.endpoint'))

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})
const embeddings = EmbeddingService.fromConfig(config)
const search = new SearchService({ client, index, embeddings, adapter: bookmarkSearchAdapter })

const loaded = await search.loadDocuments()

if (flags.facets) {
  const facets = await search.facets()
  for (const [facet, values] of Object.entries(facets)) {
    console.log(`\n${facet}`)
    for (const { value, count } of values.slice(0, 20)) {
      console.log(`  ${String(count).padStart(4)}  ${value}`)
    }
  }
  process.exit(0)
}

const queryText = text
const facets = {
  bookmarkType: flag('bookmarkType') || flag('type'),
  domain: flag('domain')
}

if (!queryText && !Object.values(facets).some(Boolean)) {
  console.error('Usage: node bin/search.js "query text" [--bookmarkType arxiv-paper] [--domain github.com] [--facets]')
  process.exit(1)
}

const started = Date.now()
const { results, total, signals } = queryText
  ? await search.search(queryText, { facets, limit: 10 })
  : await search.browse({ facets, limit: 10 })
const elapsed = Date.now() - started

console.log(`\n"${queryText}"  ${JSON.stringify(Object.fromEntries(Object.entries(facets).filter(([, v]) => v)))}`)
console.log(`${total} of ${loaded} bookmarks, ${elapsed}ms`)
if (signals) console.log(`signals: ${signals.vectorCandidates} vector candidates, filter ${signals.filtered ?? 'none'}\n`)

for (const [i, r] of results.entries()) {
  const score = r.score !== undefined ? r.score.toFixed(3) : '   - '
  const detail = r.signals ? ` (lex ${r.signals.lexical.toFixed(2)} vec ${r.signals.vector.toFixed(2)})` : ''
  console.log(`${String(i + 1).padStart(2)}. ${score}  ${r.name}${r.domain ? ` — ${r.domain}` : ''}${detail}`)
  if (r.description) console.log(`      ${r.description.split('\n')[0].slice(0, 120)}`)
  console.log(`      ${r.url}`)
}
