import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import EventStore from '../../src/calendar/EventStore.js'

/** EventStore against a live store (npm run test:store), in graph:facet/calendar-test. */

let registry, store

beforeAll(async () => {
  const client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new EventStore({ client, repository, now: () => new Date(2026, 9, 6, 12) })
  store.graph = () => repository.facetGraph('calendar-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'calendar-test')
})

describe('EventStore against the store', () => {
  it('saves, reloads, edits and deletes appointments', async () => {
    await store.create({ title: 'Store "dentist"', date: '2026-10-08', time: '14:30', location: 'High St', notes: 'Line one\nLine two' }, 'test')
    await store.create({ title: 'All day', date: '2026-10-09' }, 'test')
    store.reset()
    expect((await store.list()).map(e => e.title)).toEqual(['Store "dentist"', 'All day'])
    const dentist = await store.get('store-dentist')
    expect(dentist).toMatchObject({ date: '2026-10-08', time: '14:30', location: 'High St', notes: 'Line one\nLine two', modified: null })
    await store.update(dentist, { time: '', date: '2026-10-10' }, 'test')
    store.reset()
    expect(await store.get('store-dentist')).toMatchObject({ date: '2026-10-10', time: null })
    for (const e of await store.list()) await store.delete(e, 'test')
    store.reset()
    expect(await store.list()).toEqual([])
  })
})
