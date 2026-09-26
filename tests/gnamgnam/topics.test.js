import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import { buildTopics, termKey } from '../../src/gnamgnam/topics/buildTopics.js'
import { topicTriples, topicIri } from '../../src/gnamgnam/topics/topicTriples.js'
import { bookmarkSearchAdapter } from '../../src/gnamgnam/BookmarkSearch.js'

const B = 'http://purl.org/stuff/dim/bookmark/'

function corpus () {
  const docs = []
  const add = (n, terms) => { for (let i = 0; i < n; i++) docs.push({ iri: `${B}${docs.length}`, terms: typeof terms === 'function' ? terms(i) : terms }) }
  add(12, i => ['Knowledge-Graphs', i < 10 ? 'RDF' : 'sparql', 'github.com'])
  add(6, ['knowledge graph', 'semantic web', 'rdf'])
  add(10, i => ['modular synthesizers', i % 2 ? 'eurorack' : 'synth DIY'])
  add(10, ['cs.AI', 'machine-learning'])
  add(40, ['misc'])
  add(3, ['woodcarving'])
  return docs
}

describe('topic terms', () => {
  it('normalises spellings and drops noise', () => {
    expect(termKey('Knowledge-Graphs')).toBe('knowledge graphs')
    expect(termKey('knowledge_graph')).toBe('knowledge graph')
    expect(buildTopics([{ iri: 'a', terms: ['ontologies'] }, { iri: 'b', terms: ['ontology'] }], { minDocs: 2, maxShare: 1 }).topics.map(t => t.key)).toEqual(['ontology'])
    expect(termKey('cs.AI')).toBe('artificial intelligence')
    expect(termKey('kubernetes')).toBe('kubernetes')
    expect(termKey('analysis')).toBe('analysis')
    expect(termKey('github.com')).toBeNull()
    expect(termKey('en.wikipedia.org')).toBeNull()
    expect(termKey('node.js')).toBe('node.js')
    expect(termKey('2024')).toBeNull()
    expect(termKey('Open Source')).toBeNull()
  })
})

describe('buildTopics', () => {
  it('keeps shared, specific terms; nests; picks the most specific per bookmark', () => {
    const { topics, assignments } = buildTopics(corpus(), { minDocs: 5, maxShare: 0.3 })
    const labels = topics.map(t => t.label)
    expect(labels).toEqual(['knowledge-graphs', 'rdf', 'artificial intelligence', 'machine-learning', 'modular synthesizers', 'semantic web', 'eurorack', 'synth diy'])
    expect(labels).not.toContain('misc') // on 49% of bookmarks
    expect(labels).not.toContain('woodcarving') // on 3
    const kg = topics.find(t => t.key === 'knowledge graph')
    expect(kg.altLabels).toEqual(['knowledge graph'])
    expect(kg.size).toBe(18)
    expect(topics.find(t => t.key === 'eurorack').broader).toBe('modular synthesizers')
    expect(topics.find(t => t.key === 'semantic web').broader).toBe('rdf')
    expect(topics.find(t => t.key === 'rdf').broader).toBeNull() // 16 isn't 1.5× smaller than 18
    expect(assignments.get(`${B}0`)).toEqual(['rdf', 'knowledge graph'])
    expect(assignments.get(`${B}12`)).toEqual(['semantic web', 'rdf', 'knowledge graph'])
    expect(assignments.get(`${B}18`)).toEqual(['synth diy', 'modular synthesizers'])
    expect(assignments.has(`${B}40`)).toBe(false)
    // Deterministic.
    expect(buildTopics(corpus(), { minDocs: 5, maxShare: 0.3 }).topics.map(t => t.key)).toEqual(topics.map(t => t.key))
  })

  it('writes a valid SKOS scheme and subjects, and search reads them back', async () => {
    const result = buildTopics(corpus(), { minDocs: 5, maxShare: 0.3 })
    const groups = topicTriples(result, { now: new Date('2026-09-26T00:00:00Z') })
    const flat = groups.flat()
    expect((await (await ShapeValidator.load()).validateTriples(flat)).conforms).toBe(true)
    expect(flat).toContain(`<${topicIri('eurorack')}> <http://www.w3.org/2004/02/skos/core#broader> <${topicIri('modular-synthesizers')}> .`)
    expect(flat.filter(t => t.includes('hasTopConcept'))).toHaveLength(5)
    const doc = bookmarkSearchAdapter.toDocument({ bookmark: `${B}0`, url: 'https://e.org', topics: 'rdf | knowledge-graphs' }, null)
    expect(doc.topics).toEqual(['rdf', 'knowledge-graphs'])
    expect(bookmarkSearchAdapter.documentFilter({ topic: 'rdf' })(doc)).toBe(true)
    expect(bookmarkSearchAdapter.documentFacets([doc]).topic).toEqual([{ value: 'knowledge-graphs', count: 1 }, { value: 'rdf', count: 1 }])
  })
})
