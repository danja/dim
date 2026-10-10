import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import TaskStore from '../../src/farelo/TaskStore.js'
import { columns } from '../../src/farelo/tasks.js'

/** TaskStore against a live store, in graph:facet/farelo-test (removed after). */

let registry, store

beforeAll(async () => {
  const client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new TaskStore({ client, repository })
  store.graph = () => repository.facetGraph('farelo-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'farelo-test')
})

describe('TaskStore against the store', () => {
  it('creates, edits, orders, moves and deletes tasks, and reloads them', async () => {
    const project = await store.create({ title: 'Project X', isProject: 'true', status: 'doing' }, 'test')
    const a = await store.create({ title: 'A', project: project.id, priority: '1', due: '2026-10-01', tags: 'Desk, @home' }, 'test')
    const b = await store.create({ title: 'B "quoted"', note: 'line one\nline two' }, 'test')
    await store.update(b, { dependsOn: [a.id] }, 'test')
    await expect(store.move(await store.get(b.id), { status: 'doing' }, 'test')).rejects.toMatchObject({ status: 409 })
    await store.move(await store.get(b.id), { status: 'todo', before: a.id }, 'test')
    expect(columns(await store.list()).todo.map(t => t.title)).toEqual(['B "quoted"', 'A'])
    await store.move(await store.get(a.id), { status: 'done' }, 'test')
    await store.move(await store.get(b.id), { status: 'doing' }, 'test')

    store.tasks = null // reload from the store
    const reloaded = await store.get(a.id)
    expect(reloaded).toMatchObject({ title: 'A', status: 'done', priority: 1, due: '2026-10-01', project: project.iri, tags: ['desk', '@home'] })
    expect(reloaded.doneAt).toBeTruthy()
    expect(await store.get(b.id)).toMatchObject({ status: 'doing', note: 'line one\nline two', dependsOn: [a.iri] })
    expect((await store.get(project.id)).isProject).toBe(true)

    await store.delete(await store.get(a.id), 'test')
    expect((await store.get(b.id)).dependsOn).toEqual([])
    store.tasks = null
    expect(await store.get(a.id)).toBeNull()
    expect((await store.get(b.id)).dependsOn).toEqual([])
  })

  it('places cards in Done as they appear on screen (newest first)', async () => {
    const shown = async () => columns(await store.list()).done.filter(t => t.title.startsWith('D')).map(t => t.title)
    const d1 = await store.create({ title: 'D1', status: 'done' }, 'test')
    const d2 = await store.create({ title: 'D2', status: 'done' }, 'test')
    const d3 = await store.create({ title: 'D3', status: 'done' }, 'test')
    expect(await shown()).toEqual(['D3', 'D2', 'D1']) // new ones on top
    await store.move(d1, { status: 'done', after: d3.id }, 'test') // dropped just below D3
    expect(await shown()).toEqual(['D3', 'D1', 'D2'])
    await store.move(await store.get(d2.id), { status: 'done', before: d3.id }, 'test') // just above D3
    expect(await shown()).toEqual(['D2', 'D3', 'D1'])
    for (const t of [d1, d2, d3]) await store.delete(await store.get(t.id), 'test')
  })

  it('archives a task out of the lists and restores it, across a reload', async () => {
    const waiting = await store.create({ title: 'ArchWaiting' }, 'test')
    const gone = await store.create({ title: 'ArchGone' }, 'test')
    await store.update(waiting, { dependsOn: [gone.id] }, 'test')
    await store.archive(await store.get(gone.id), 'test')
    store.tasks = null
    expect((await store.list()).some(t => t.id === gone.id)).toBe(false)
    expect((await store.listArchived()).map(t => t.id)).toContain(gone.id)
    expect((await store.get(waiting.id)).dependsOn).toEqual([])
    await store.restore(await store.get(gone.id), 'test')
    store.tasks = null
    expect((await store.list()).some(t => t.id === gone.id)).toBe(true)
    for (const t of [waiting, gone]) await store.delete(await store.get(t.id), 'test')
  })

  it('refuses bad input', async () => {
    await expect(store.create({ title: '' }, 'test')).rejects.toThrow(/title/)
    await expect(store.create({ title: 'x', priority: '0' }, 'test')).rejects.toThrow(/Priority/)
    await expect(store.create({ title: 'x', due: 'tomorrow' }, 'test')).rejects.toThrow(/YYYY-MM-DD/)
    await expect(store.create({ title: 'x', dependsOn: ['t000'] }, 'test')).rejects.toThrow(/not a known task/)
  })
})
