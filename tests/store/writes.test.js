import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Config from '../../src/common/Config.js'
import SPARQLClient from '../../src/common/store/SPARQLClient.js'
import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import ChangeLog from '../../src/common/store/ChangeLog.js'
import Repository from '../../src/common/store/Repository.js'
import LinkStore from '../../src/common/links/LinkStore.js'
import { annotationTriples, TAG_PREDICATE, NOTE_PREDICATE } from '../../src/gnamgnam/Annotations.js'

/**
 * The write path against a live store (npm run test:store). Uses its own
 * facet graph, graph:facet/store-test, and removes it afterwards. The
 * change-log entries it writes stay in graph:system/changes.
 */

const A = 'http://purl.org/stuff/dim/bookmark/store-test-a'
const B = 'http://purl.org/stuff/dim/bookmark/store-test-b'

let client, registry, repository, graph

beforeAll(async () => {
  client = new SPARQLClient(Config.load().get('storage.endpoint'))
  if (!(await client.isReachable())) throw new Error('The store suite needs a live SPARQL endpoint (see .env)')
  registry = new GraphRegistry(client)
  repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: new ChangeLog({ client, registry }), registry })
  graph = await repository.facetGraph('store-test')
})

afterAll(async () => {
  if (registry) await registry.drop('facet', 'store-test')
})

describe('Repository against the store', () => {
  it('registers the facet graph', async () => {
    expect(await registry.isRegistered('facet', 'store-test')).toBe(true)
  })

  it('writes, replaces and clears annotations', async () => {
    const predicates = [TAG_PREDICATE, NOTE_PREDICATE]
    await repository.replace({ graph, subject: A, predicates, triples: annotationTriples(A, { tags: ['a', 'b'], note: 'First "quoted" note\nline two' }), actor: 'test' })
    let now = await repository.describe(graph, A)
    expect(now).toHaveLength(3)
    expect(now.join('\n')).toMatch('line two')

    await repository.replace({ graph, subject: A, predicates, triples: annotationTriples(A, { tags: ['c'], note: null }), actor: 'test' })
    now = await repository.describe(graph, A)
    expect(now).toEqual([`<${A}> <${TAG_PREDICATE}> "c" .`])

    await repository.replace({ graph, subject: A, predicates, triples: [], actor: 'test' })
    expect(await repository.describe(graph, A)).toEqual([])
  })

  it('never writes what the shapes reject', async () => {
    await expect(repository.replace({ graph, subject: A, predicates: [TAG_PREDICATE], triples: [`<${A}> <${TAG_PREDICATE}> "Upper" .`], actor: 'test' }))
      .rejects.toMatchObject({ status: 422 })
    expect(await repository.describe(graph, A)).toEqual([])
  })
})

describe('LinkStore against the store', () => {
  let links
  beforeAll(() => {
    links = new LinkStore({ client, repository })
    links.graph = async () => graph // keep test links out of graph:facet/links
  })

  it('reads links from both ends', async () => {
    await links.add({ from: A, kind: 'resource', to: B, actor: 'test' })
    await links.add({ from: B, kind: 'related', to: A, actor: 'test' })
    expect(await links.linksOf(A)).toEqual(expect.arrayContaining([
      { kind: 'resource', direction: 'out', iri: B },
      { kind: 'related', direction: 'out', iri: B }
    ]))
    expect(await links.linksOf(B)).toEqual(expect.arrayContaining([{ kind: 'resource', direction: 'in', iri: A }]))
  })

  it('syncs mentions and removes links', async () => {
    await links.syncMentions({ from: A, targets: [B], actor: 'test' })
    expect((await links.linksOf(A)).filter(l => l.kind === 'mentions')).toHaveLength(1)
    await links.syncMentions({ from: A, targets: [], actor: 'test' })
    await links.remove({ from: A, kind: 'resource', to: B, actor: 'test' })
    await links.remove({ from: B, kind: 'related', to: A, actor: 'test' })
    expect(await links.linksOf(A)).toEqual([])
  })
})
