import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import WikiStore from '../../src/wiki/WikiStore.js'

/**
 * WikiStore against a live store (npm run test:store). Works in its own
 * facet graph (graph:facet/wiki-test), removed afterwards.
 */

let registry, store, client

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new WikiStore({ client, repository })
  store.graph = () => repository.facetGraph('wiki-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'wiki-test')
})

describe('WikiStore against the store', () => {
  it('keeps every revision and reloads the current text', async () => {
    const text = 'Line with "quotes" and \\ backslash\nand [[Other]] ```code```'
    await store.save({ title: 'Store Test', content: 'first', tags: 'a, b', actor: 'test' })
    await store.save({ slug: 'store-test', title: 'Store Test', content: text, baseRevision: 1, actor: 'test' })
    await store.save({ slug: 'store-test', title: 'Store Test Renamed', content: `${text}\nmore`, baseRevision: 2, actor: 'test' })

    store.reset()
    const page = await store.get('store-test')
    expect(page).toMatchObject({ title: 'Store Test Renamed', revision: 3, content: `${text}\nmore` })
    expect(page.tags.sort()).toEqual(['a', 'b'])
    expect((await store.revisions(page)).map(r => [r.n, r.title])).toEqual([[3, 'Store Test Renamed'], [2, 'Store Test'], [1, 'Store Test']])
    expect((await store.revision(page, 2)).content).toBe(text)
    expect(await store.turtle(page)).toContain('wasRevisionOf')

    await expect(store.save({ slug: 'store-test', title: 'x', content: 'stale', baseRevision: 2, actor: 'test' })).rejects.toMatchObject({ status: 409 })

    await store.delete(page, 'test')
    store.reset()
    expect(await store.get('store-test')).toBeNull()
    expect(await store.revisions(page)).toEqual([])
  })
})
