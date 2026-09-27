#!/usr/bin/env node
import Config from '../src/common/Config.js'
import { createServer } from '../src/server.js'
import Auth from '../src/common/http/auth.js'
import { buildApp } from '../src/app.js'
import { NEWS_CONFIG } from '../config/preferences.js'
import { configureLogging } from '../src/common/logging.js'

const logging = configureLogging()

const config = Config.load()
const port = Number(process.env.PORT) || 4110

let app
try {
  app = await buildApp({ config, projectRoot: Config.projectRoot })
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
const { index, embeddings, search, related, topics, repository, links, poller, facets } = app
const newsStore = app.stores.news
console.log(`Loaded ${search.documents.size} bookmarks, ${index.size} vectors from ${index.path}`)
console.log(`Related index: ${related.index.size} vectors (wiki, tasks, outline items, posts, recent news)`)

const auth = Auth.fromEnv()
const server = createServer({ facets, config, projectRoot: Config.projectRoot, services: { auth, repository, links, related, topics }, logRequests: logging.requests })

// Keep the related index in step: shortly after start, then every
// RELATED_SYNC_MINUTES (default 30; 0 turns it off). Only what changed is
// embedded; nothing is tried while Ollama is unreachable.
const relatedEvery = Number(process.env.RELATED_SYNC_MINUTES ?? 30)
let relatedTimer = null
if (relatedEvery > 0) {
  const syncRelated = async () => {
    if (!(await embeddings.provider.isAvailable().catch(() => false))) return
    const totals = await related.sync(facets).catch(error => ({ error: error.message }))
    if (totals.error) console.error('[related] sync failed:', totals.error)
    else if (totals.embedded || totals.removed) console.log(`[related] embedded ${totals.embedded}, removed ${totals.removed}${totals.stopped ? ' (stopped: embeddings unavailable)' : ''}`)
  }
  setTimeout(syncRelated, 30000)
  relatedTimer = setInterval(syncRelated, relatedEvery * 60000)
}
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
  console.log(auth.writesEnabled
    ? '  writes: enabled — log in at /login with DIM_WRITE_TOKEN'
    : '  writes: disabled — set DIM_WRITE_TOKEN (16+ chars) in .env to enable notes, tags and links')
  if (auth.privateReads) console.log('  reads: private — every page needs a login (DIM_PRIVATE)')
  console.log(`  facets: ${facets.map(f => `/${f.id}/`).join('  ')}`)
  console.log('  GET /gnamgnam/?q=...            bookmark search page')
  console.log('  GET /gnamgnam/search?q=...      hybrid search JSON, optional bookmarkType/domain')
  console.log('  GET /gnamgnam/facets            facet values and counts')
  console.log('  GET /gnamgnam/bookmarks         browse')
  console.log('  GET /gnamgnam/bookmark/<slug>   one bookmark (.ttl for Turtle)')
  console.log('  GET /find?q=...                 search every facet')
  console.log('  GET /r/<type>/<slug>            a resource\'s page')
  console.log('  GET /health                     per-facet status')
  console.log('  GET /ns/<name>.ttl              the vocabularies the data refers to')
})

// Background polling: NEWS_POLL_MINUTES=15 checks every 15 minutes for due
// feeds (each feed is still polled at most every pollIntervalMinutes), and
// prunes old items once a day. Off unless set.
const pollEvery = Number(process.env.NEWS_POLL_MINUTES ?? 0)
let pollTimer = null
if (pollEvery > 0) {
  let lastPrune = 0
  const tick = async () => {
    try {
      const totals = await poller.pollDue()
      if (totals.polled) console.log(`[news] polled ${totals.polled}: ${totals.fresh} new items, ${totals.error + totals.refused} failed`)
      if (Date.now() - lastPrune > 86400000) {
        lastPrune = Date.now()
        const pruned = await newsStore.prune({ days: NEWS_CONFIG.retentionDays })
        if (pruned) console.log(`[news] pruned ${pruned} items older than ${NEWS_CONFIG.retentionDays} days`)
      }
    } catch (error) {
      console.error('[news] poll run failed:', error.message)
    }
  }
  setTimeout(tick, 10000)
  pollTimer = setInterval(tick, pollEvery * 60000)
  console.log(`  news: polling due feeds every ${pollEvery} min`)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(pollTimer)
    clearInterval(relatedTimer)
    server.close(() => process.exit(0))
  })
}
