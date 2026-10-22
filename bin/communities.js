#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import { buildApp } from '../src/app.js'
import { FacetRegistry } from '../src/common/facets/FacetRegistry.js'
import { buildCommunities } from '../src/common/rag/buildCommunities.js'

/**
 * Optional graph RAG input: cluster the links/topics graph into communities,
 * summarise each with a local LLM (OLLAMA_URL; qwen2.5:3b by default, see
 * RAG_CONFIG.communities) and embed the summary into data/communities.json.
 * Searches use them with ?communities=1 (or bin/ask.js --communities).
 * A community whose members are unchanged keeps its summary, so reruns are
 * cheap. Without a reachable LLM a plain list of titles stands in.
 *
 *   node bin/communities.js            build
 *   node bin/communities.js --list     show what was built
 */

logger.setLevel('warn')
const list = process.argv.includes('--list')
let app
try {
  app = await buildApp({ config: Config.load(), projectRoot: Config.projectRoot })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { communities, links, topics, embeddings } = app
const registry = new FacetRegistry(app.facets)

if (list) {
  console.log(`${communities.size} communities, built ${communities.builtAt ?? 'never'}`)
  for (const c of communities.communities) console.log(`\n${c.id}  ${c.size} items${c.llm ? '' : '  (titles only)'}\n  ${c.summary.replace(/\s+/g, ' ').slice(0, 300)}`)
  process.exit(0)
}

const baseUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
const result = await buildCommunities({
  links,
  topics,
  registry,
  embeddings,
  previous: communities.communities,
  baseUrl,
  onProgress: t => console.log(`${t.done}/${t.total}  reused ${t.reused}, summarised ${t.summarised}, titles only ${t.fallback}`)
})
await communities.save(result.communities)
console.log(`${result.communities.length} communities saved (reused ${result.reused}, summarised ${result.summarised}, titles only ${result.fallback}).`)
process.exit(0)
