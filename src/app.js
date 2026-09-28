import SPARQLClient from './common/store/SPARQLClient.js'
import VectorIndex from './common/vectors/VectorIndex.js'
import EmbeddingService from './common/embeddings/EmbeddingService.js'
import SearchService from './common/search/SearchService.js'
import { bookmarkSearchAdapter } from './gnamgnam/BookmarkSearch.js'
import { createFacets } from './facets.js'
import ShapeValidator from './common/store/ShapeValidator.js'
import GraphRegistry from './common/store/GraphRegistry.js'
import ChangeLog from './common/store/ChangeLog.js'
import Repository from './common/store/Repository.js'
import LinkStore from './common/links/LinkStore.js'
import OutlineStore from './trestle/OutlineStore.js'
import TaskStore from './farelo/TaskStore.js'
import WikiStore from './wiki/WikiStore.js'
import NewsStore from './news/NewsStore.js'
import FeedInbox from './news/FeedInbox.js'
import PostStore from './blog/PostStore.js'
import Advisor from './advisor/Advisor.js'
import AdviceStore from './advisor/AdviceStore.js'
import Poller from './news/Poller.js'
import RollLog from './farelo/RollLog.js'
import { openRelated } from './common/related/openRelated.js'
import TopicStore from './common/topics/TopicStore.js'
import AutoEnricher from './gnamgnam/AutoEnricher.js'
import { createEnricher, SUMMARISER_CHOICES } from './gnamgnam/enrich/registry.js'
import { ENRICH_CONFIG } from '../config/preferences.js'

/**
 * The whole of DIM, assembled: the store client, bookmark search, the write
 * path, every facet's store, the related index and the facets themselves.
 * bin/serve.js serves it; tools that need every facet (bin/related.js) use
 * it too, so there is one place that knows how DIM is put together.
 */
export async function buildApp ({ config, projectRoot, env = process.env }) {
  const client = new SPARQLClient(config.get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error(`SPARQL endpoint ${config.get('storage.endpoint.query')} is not reachable.`)

  const index = await VectorIndex.open({ dimension: config.get('embedding.dimension'), path: config.get('index.path'), model: config.get('embedding.model') })
  const embeddings = EmbeddingService.fromConfig(config)
  const search = new SearchService({ client, index, embeddings, adapter: bookmarkSearchAdapter })
  await search.loadDocuments()
  const related = await openRelated({ config, projectRoot, bookmarks: index, embeddings })

  // The write path: validated writes into facet graphs, a change log, links.
  const registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  const links = new LinkStore({ client, repository })

  const outlines = new OutlineStore({ client, repository, links })
  const tasks = new TaskStore({ client, repository, links })
  const wiki = new WikiStore({ client, repository, links })
  const newsStore = new NewsStore({ client, repository, links })
  const poller = new Poller({ store: newsStore })
  // Feeds found on bookmarked pages, waiting on Manage feeds.
  const inbox = new FeedInbox({ client, news: newsStore })
  const autoEnrich = autoEnricher({ client, search, embeddings, index, env, observers: [inbox.observer()] })
  const posts = new PostStore({ client, repository, links })
  const advisor = new Advisor({ tasks, advice: new AdviceStore({ client, repository, links }), links })
  advisor.relatedIndex = related
  const rolls = new RollLog({ client, registry })
  const blog = { store: posts, title: env.BLOG_TITLE || 'Blog', author: env.BLOG_AUTHOR || 'owner' }
  const facets = createFacets({ search, autoEnrich, outlines, tasks, rolls, wiki, news: { store: newsStore, poller, inbox }, blog, client, advisor })

  const topics = new TopicStore({ client })
  return { client, index, embeddings, search, autoEnrich, related, topics, registry, repository, links, stores: { outlines, tasks, wiki, news: newsStore, posts, rolls }, inbox, poller, advisor, facets }
}

/**
 * Bookmarks saved in DIM are fetched, summarised and embedded as they are
 * saved. AUTO_ENRICH=0 turns it off; ENRICH_SUMMARISER picks the summariser
 * (ollama | remote | extractive; default ENRICH_CONFIG.summariser). The
 * offline summarisers answer whenever an LLM can't.
 */
function autoEnricher ({ client, search, embeddings, index, env, observers = [] }) {
  if (/^(0|false|no|off)$/i.test(env.AUTO_ENRICH ?? '')) return null
  const summariser = env.ENRICH_SUMMARISER || ENRICH_CONFIG.summariser
  if (!SUMMARISER_CHOICES.includes(summariser)) throw new Error(`ENRICH_SUMMARISER must be ${SUMMARISER_CHOICES.join(' | ')}, got ${JSON.stringify(summariser)}`)
  return new AutoEnricher({ createEnricher: () => createEnricher(client, { summariser, ollamaBaseUrl: env.OLLAMA_URL, observers }), search, embeddings, index })
}

export default buildApp
