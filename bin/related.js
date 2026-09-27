#!/usr/bin/env node
import logger from 'loglevel'
import Config from '../src/common/Config.js'
import { buildApp } from '../src/app.js'

/**
 * Bring the cross-facet "related" index in step (the server also does this
 * every RELATED_SYNC_MINUTES): wiki pages, tasks, outline items, published
 * posts and recent news items are embedded beside the bookmarks; only what
 * changed is embedded. Needs Ollama with the embedding model.
 *
 *   node bin/related.js                  sync
 *   node bin/related.js --limit 500      at most 500 embeddings this run
 *   node bin/related.js --status         counts only
 *
 * The first run embeds everything (the outline alone can be thousands of
 * items: minutes on a CPU). Stop the server first, or restart it after, so
 * it sees the new index.
 */

logger.setLevel('warn')
const args = process.argv.slice(2)
const limitAt = args.indexOf('--limit')
const limit = limitAt === -1 ? Infinity : Number(args[limitAt + 1])

let app
try {
  app = await buildApp({ config: Config.load(), projectRoot: Config.projectRoot })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { related, embeddings, facets } = app
const byFacet = {}
for (const { facet } of related.state.values()) byFacet[facet] = (byFacet[facet] ?? 0) + 1
console.log(`Related index: ${related.index.size} vectors ${JSON.stringify(byFacet)}; bookmarks have their own index (${app.index.size}).`)
if (args.includes('--status')) process.exit(0)

if (!(await embeddings.provider.isAvailable())) {
  console.error('Ollama is not reachable (OLLAMA_URL), or the embedding model is not pulled.')
  process.exit(1)
}
const started = Date.now()
let last = 0
const totals = await related.sync(facets, {
  limit,
  onProgress: t => {
    if (t.embedded - last >= 100) {
      last = t.embedded
      console.log(`  ${t.embedded} embedded (${((Date.now() - started) / 1000).toFixed(0)}s)`)
    }
  }
})
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${JSON.stringify(totals)}`)
process.exit(0)
