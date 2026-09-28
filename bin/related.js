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
 * The first run embeds everything: the outline alone can be thousands of
 * items, and on a CPU nomic-embed-text takes around a second per item or
 * more (texts are sent in batches of 16). Progress is saved every 200, so
 * it's safe to stop with Ctrl-C and run again (or use --limit). A lock file
 * keeps this and the server's own sync from running at once; the server
 * picks up what this saved at its next sync.
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
let total = 0
let last = 0
const minutes = s => s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`
const totals = await related.sync(facets, {
  limit,
  onStart: t => {
    total = t.todo
    console.log(`${t.todo} to embed, ${t.unchanged} unchanged, ${t.removed} removed.`)
  },
  onProgress: t => {
    if (t.embedded - last < 100 && t.embedded < total) return
    last = t.embedded
    const took = (Date.now() - started) / 1000
    const left = (total - t.embedded) * took / t.embedded
    console.log(`  ${t.embedded}/${total} embedded (${minutes(took)}; ~${minutes(left)} left, ${(took / t.embedded).toFixed(2)}s each)`)
  }
})
if (totals.busy) {
  console.error('Another process (probably the server) is syncing the related index now; try again when it has finished, or run the server with RELATED_SYNC_MINUTES=0.')
  process.exit(1)
}
console.log(`Done in ${minutes((Date.now() - started) / 1000)}: ${JSON.stringify(totals)}`)
process.exit(0)
