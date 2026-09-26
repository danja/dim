#!/usr/bin/env node
import logger from 'loglevel'
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

logger.setLevel('info')

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
const facets = createFacets({ search, outlines })
const server = createServer({ facets, config, projectRoot: Config.projectRoot, services: { auth, repository, links } })
server.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`)
  console.log(auth.writesEnabled
    ? '  writes: enabled — log in at /login with DIM_WRITE_TOKEN'
    : '  writes: disabled — set DIM_WRITE_TOKEN (16+ chars) in .env to enable notes, tags and links')
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
