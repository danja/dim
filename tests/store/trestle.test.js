import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import OutlineStore from '../../src/trestle/OutlineStore.js'
import { toMarkdown } from '../../src/trestle/tree.js'

/**
 * OutlineStore against a live store (npm run test:store). Works in its own
 * facet graph (graph:facet/trestle-test), removed afterwards.
 */

let registry, store, client

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  store = new OutlineStore({ client, repository })
  store.graph = () => repository.facetGraph('trestle-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'trestle-test')
})

describe('OutlineStore against the store', () => {
  it('creates, edits, moves and deletes, and reloads the same tree', async () => {
    const outline = await store.createOutline({ title: 'Store test', actor: 'test' })
    const a = await store.createNode(outline, { title: 'A', actor: 'test' })
    const b = await store.createNode(outline, { after: a.id, title: 'B', actor: 'test' })
    const c = await store.createNode(outline, { after: a.id, title: 'C', actor: 'test' })
    expect(toMarkdown(outline, outline.iri)).toBe('- A\n- C\n- B\n')

    await store.move(outline, b, 'indent', 'test') // B under C
    await store.updateNode(outline, c, { title: 'C "quoted"', note: 'Note\nlines' }, 'test')
    await store.move(outline, c, 'up', 'test')
    expect(toMarkdown(outline, outline.iri)).toBe('- C "quoted"\n  - B\n- A\n')

    store.reset()
    const again = await store.outline(outline.slug)
    expect(toMarkdown(again, again.iri)).toBe('- C "quoted"\n  - B\n- A\n')
    expect([...again.nodes.values()].find(n => n.title.startsWith('C')).note).toBe('Note\nlines')

    const cAgain = [...again.nodes.values()].find(n => n.title.startsWith('C'))
    expect(await store.deleteNode(again, cAgain, 'test')).toHaveLength(2)
    store.reset()
    const last = await store.outline(outline.slug)
    expect(toMarkdown(last, last.iri)).toBe('- A\n')
  })

  it('renumbers siblings when positions get too close', async () => {
    const outline = await store.createOutline({ title: 'Crowded', actor: 'test' })
    const first = await store.createNode(outline, { title: 'first', actor: 'test' })
    await store.createNode(outline, { after: first.id, title: 'last', actor: 'test' })
    for (let i = 0; i < 25; i++) await store.createNode(outline, { after: first.id, title: `n${i}`, actor: 'test' })
    const titles = toMarkdown(outline, outline.iri).trim().split('\n').map(l => l.slice(2))
    expect(titles[0]).toBe('first')
    expect(titles[1]).toBe('n24')
    expect(titles.at(-1)).toBe('last')
    store.reset()
    const reloaded = await store.outline(outline.slug)
    expect(toMarkdown(reloaded, reloaded.iri)).toBe(toMarkdown(outline, outline.iri))
  })
})
