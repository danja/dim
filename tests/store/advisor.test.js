import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import AdviceStore from '../../src/advisor/AdviceStore.js'
import { DEFAULT_WEIGHTS } from '../../src/advisor/score.js'

/** AdviceStore against a live store (npm run test:store), in graph:facet/advisor-test. */

let registry, store

beforeAll(async () => {
  const client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new AdviceStore({ client, repository })
  store.graph = () => repository.facetGraph('advisor-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'advisor-test')
})

describe('AdviceStore against the store', () => {
  it('keeps feedback and weights', async () => {
    expect(await store.weights()).toEqual(DEFAULT_WEIGHTS)
    await store.record({ task: 'http://purl.org/stuff/dim/task/a', action: 'skip', rank: 1 }, 'test')
    await store.record({ task: 'http://purl.org/stuff/dim/task/a', action: 'skip', rank: 2 }, 'test')
    await store.record({ task: 'http://purl.org/stuff/dim/task/b', action: 'accept', rank: 3 }, 'test')
    const skips = await store.skips()
    expect(skips.get('http://purl.org/stuff/dim/task/a')).toHaveLength(2)
    expect(skips.has('http://purl.org/stuff/dim/task/b')).toBe(false)
    await store.saveWeights({ ...DEFAULT_WEIGHTS, priority: 2.5 }, 'test')
    await store.saveWeights({ ...DEFAULT_WEIGHTS, priority: 2.4 }, 'test')
    expect((await store.weights()).priority).toBe(2.4)
    await expect(store.record({ task: 'http://purl.org/stuff/dim/task/a', action: 'maybe' }, 'test')).rejects.toThrow()
  })
})
