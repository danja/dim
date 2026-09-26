import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import NewsStore from '../../src/news/NewsStore.js'

/**
 * NewsStore against a live store (npm run test:store). Uses its own graphs
 * (graph:facet/news-test, graph:source/news-test), removed afterwards.
 */

let registry, store, client

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new NewsStore({ client, repository })
  store.graph = () => repository.facetGraph('news-test')
  store.itemGraph = async () => {
    await registry.register({ kind: 'source', id: 'news-test', licence: 'proprietary-linkout', derivedFrom: 'test' })
    return GraphRegistry.graphIri('source', 'news-test')
  }
})

afterAll(async () => {
  if (!registry) return
  await registry.drop('facet', 'news-test')
  await registry.drop('source', 'news-test')
})

const parsed = n => Array.from({ length: n }, (_, i) => ({ guid: `g${i}`, link: `https://n.example/${i}?a=1|2`, title: `Item "${i}"`, published: `2026-09-${String(10 + i).padStart(2, '0')}T00:00:00.000Z`, author: 'A', summary: `Text ${i}\n\nmore`, categories: ['x'] }))

describe('NewsStore against the store', () => {
  it('subscribes, stores items and flags, reloads, prunes and unsubscribes', async () => {
    const feed = await store.addFeed({ url: 'https://n.example/feed', title: 'N', tags: 'A, b' }, 'test')
    await store.recordPoll(feed, { status: 'ok', format: 'rss', etag: '"e"', lastPolled: '2026-09-20T00:00:00.000Z', failures: 0, httpStatus: 200 })
    expect(await store.addItems(feed, parsed(5))).toHaveLength(5)
    expect(await store.addItems(feed, parsed(6))).toHaveLength(1)
    const { items } = await store.itemList()
    await store.setFlags(items.slice(0, 2), { read: true })
    await store.setFlags([items[4]], { starred: true })
    await store.setFlags([items[0]], { read: false })

    store.reset()
    const again = await store.feed(feed.slug)
    expect(again).toMatchObject({ title: 'N', tags: expect.arrayContaining(['a', 'b']), status: 'ok', etag: '"e"', httpStatus: 200 })
    const reloaded = await store.itemList({ view: 'all' })
    expect(reloaded.items).toHaveLength(6)
    expect(reloaded.items[0].title).toBe('Item "5"')
    expect(reloaded.items.filter(i => i.read)).toHaveLength(1)
    expect(reloaded.items.filter(i => i.starred)).toHaveLength(1)
    expect(await store.itemText(reloaded.items[0])).toBe('Text 5\n\nmore')

    store.now = () => new Date(Date.now() + 200 * 86400000)
    expect(await store.prune({ days: 90 })).toBe(5)
    store.reset()
    expect((await store.itemList({ view: 'all' })).items.map(i => i.starred)).toEqual([true])

    expect(await store.deleteFeed(await store.feed(feed.slug), 'test')).toBe(1)
    store.reset()
    expect(await store.feedList()).toEqual([])
    expect((await store.itemList({ view: 'all' })).items).toEqual([])
  })
})
