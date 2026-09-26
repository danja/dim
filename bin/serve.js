#!/usr/bin/env node
import Config from '../src/common/Config.js'
import SPARQLClient from '../src/common/store/SPARQLClient.js'
import VectorIndex from '../src/common/vectors/VectorIndex.js'
import EmbeddingService from '../src/common/embeddings/EmbeddingService.js'
import SearchService from '../src/common/search/SearchService.js'
import { bookmarkSearchAdapter } from '../src/gnamgnam/BookmarkSearch.js'
import { createServer } from '../src/server.js'
import { createFacets } from '../src/facets.js'
import Auth from '../src/common/http/auth.js'
import ShapeValidator from '../src/common/store/ShapeValidator.js'
import GraphRegistry from '../src/common/store/GraphRegistry.js'
import ChangeLog from '../src/common/store/ChangeLog.js'
import Repository from '../src/common/store/Repository.js'
import LinkStore from '../src/common/links/LinkStore.js'
import OutlineStore from '../src/trestle/OutlineStore.js'
import TaskStore from '../src/farelo/TaskStore.js'
import WikiStore from '../src/wiki/WikiStore.js'
import NewsStore from '../src/news/NewsStore.js'
import PostStore from '../src/blog/PostStore.js'
import Advisor from '../src/advisor/Advisor.js'
import AdviceStore from '../src/advisor/AdviceStore.js'
import Poller from '../src/news/Poller.js'
import { NEWS_CONFIG } from '../config/preferences.js'
import RollLog from '../src/farelo/RollLog.js'
import { configureLogging } from '../src/common/logging.js'

const logging = configureLogging()

const config = Config.load()
const port = Number(process.env.PORT) || 4110

const client = new SPARQLClient(config.get('storage.endpoint'))
if (!(await client.isReachable())) {
  console.error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)
  process.exit(1)
}

const index = await VectorIndex.open({
  dimension: config.get('embedding.dimension'),
  path: config.get('index.path'),
  model: config.get('embedding.model')
})
const embeddings = EmbeddingService.fromConfig(config)
const search = new SearchService({ client, index, embeddings, adapter: bookmarkSearchAdapter })
const loaded = await search.loadDocuments()

console.log(`Loaded ${loaded} bookmarks, ${index.size} vectors from ${index.path}`)

// The write path: validated writes into facet graphs, a change log, links.
const auth = Auth.fromEnv()
const registry = new GraphRegistry(client)
const repository = new Repository({
  client,
  validator: await ShapeValidator.load(),
  changeLog: new ChangeLog({ client, registry }),
  registry
})
const links = new LinkStore({ client, repository })

const outlines = new OutlineStore({ client, repository, links })
const tasks = new TaskStore({ client, repository, links })
const wiki = new WikiStore({ client, repository, links })
const newsStore = new NewsStore({ client, repository, links })
const poller = new Poller({ store: newsStore })
const posts = new PostStore({ client, repository, links })
const advisor = new Advisor({ tasks, advice: new AdviceStore({ client, repository, links }), links })
const blog = { store: posts, title: process.env.BLOG_TITLE || 'Blog', author: process.env.BLOG_AUTHOR || 'owner' }
const rolls = new RollLog({ client, registry })
const facets = createFacets({ search, outlines, tasks, rolls, wiki, news: { store: newsStore, poller }, blog, client, advisor })
const server = createServer({ facets, config, projectRoot: Config.projectRoot, services: { auth, repository, links }, logRequests: logging.requests })
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
    server.close(() => process.exit(0))
  })
}
