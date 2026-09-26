import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import PostStore from '../../src/blog/PostStore.js'

/** PostStore against a live store (npm run test:store), in graph:facet/blog-test. */

let registry, store

beforeAll(async () => {
  const client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new PostStore({ client, repository })
  store.graph = () => repository.facetGraph('blog-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'blog-test')
})

describe('PostStore against the store', () => {
  it('drafts, publishes, edits and reloads', async () => {
    const draft = await store.create({ title: 'Store "post"', content: 'Line\n\n```\ncode\n```', tags: 'A, b', derivedFrom: 'http://purl.org/stuff/dim/page/x' }, 'test')
    const published = await store.setPublished(draft, true, 'test')
    await store.update(published, { abstract: 'Short.', tags: 'b' }, 'test')
    store.reset()
    const again = await store.get(draft.slug)
    expect(again).toMatchObject({ title: 'Store "post"', content: 'Line\n\n```\ncode\n```', status: 'published', issued: published.issued, abstract: 'Short.', tags: ['b'], derivedFrom: 'http://purl.org/stuff/dim/page/x' })
    await store.delete(again, 'test')
    store.reset()
    expect(await store.list({ drafts: true })).toEqual([])
  })
})
