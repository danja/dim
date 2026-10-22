import { describe, it, expect } from 'vitest'
import { expand } from '../../../src/common/rag/expand.js'
import { retrieve } from '../../../src/common/rag/retrieve.js'
import { RAG_CONFIG } from '../../../config/preferences.js'

const D = 'http://purl.org/stuff/dim/'
const [a, b, c, d] = ['wiki/a', 'task/b', 'bookmark/c', 'post/d'].map(x => D + x)

const links = edges => ({
  async linksOfMany (resources) {
    return new Map(resources.map(r => [r, edges[r] ?? []]))
  }
})
const topics = { async topicsOf (iri) { return iri === c ? [{ members: [c, d] }] : [] } }

describe('expand', () => {
  it('spreads along links, decaying per hop, and sums converging paths', async () => {
    const { found } = await expand([{ iri: a, score: 1 }], {
      links: links({ [a]: [{ kind: 'resource', direction: 'out', iri: b }, { kind: 'mentions', direction: 'out', iri: c }], [b]: [{ kind: 'related', direction: 'out', iri: c }] })
    })
    expect(found.get(a).seed).toBe(true)
    expect(found.get(b).hops).toBe(1)
    expect(found.get(b).score).toBeCloseTo(0.9)
    // c: 0.5 (mentions, hop 1) + 0.9 * 0.8 * 0.5 (via b, hop 2)
    expect(found.get(c).score).toBeCloseTo(0.5 + 0.36)
    expect(found.get(c).via).toHaveLength(2)
  })

  it('never lowers a seed and records the edges walked', async () => {
    const { found, edges } = await expand([{ iri: a, score: 1 }, { iri: b, score: 0.7 }], {
      links: links({ [a]: [{ kind: 'related', direction: 'out', iri: b }] })
    })
    expect(found.get(b).score).toBe(0.7)
    expect(edges).toContainEqual({ from: a, kind: 'related', to: b })
  })

  it('caps fan-out by kind strength', async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ kind: i === 4 ? 'partOf' : 'mentions', direction: 'out', iri: `${D}x/${i}` }))
    const { found } = await expand([{ iri: a, score: 1 }], { links: links({ [a]: many }), config: { ...RAG_CONFIG, fanout: 2 } })
    expect(found.has(`${D}x/4`)).toBe(true) // partOf is strongest
    expect(found.size).toBe(3)
  })

  it('goes through a small topic, and skips a general one', async () => {
    const { found } = await expand([{ iri: c, score: 1 }], { links: links({}), topics })
    expect(found.get(d).via[0].kind).toBe('topic')
    const general = { async topicsOf () { return [{ members: Array.from({ length: 99 }, (_, i) => `${D}m/${i}`) }] } }
    const big = await expand([{ iri: c, score: 1 }], { links: links({}), topics: general })
    expect(big.found.size).toBe(1)
  })
})

describe('retrieve', () => {
  const info = { [a]: 'Alpha', [b]: 'Beta', [c]: 'Gamma' }
  const registry = {
    async find () { return [{ facet: 'wiki', label: 'Wiki', results: [{ iri: a, label: 'Alpha', href: '/wiki/page/a' }] }] },
    async lookup (iri) { return info[iri] ? { iri, label: info[iri], href: `/x/${info[iri]}`, facet: 'wiki', facetLabel: 'Wiki' } : { iri, label: iri, href: null, facet: null } },
    async passage (iri) { return iri === c ? null : { text: `Text of ${info[iri]} `.repeat(200) } }
  }

  it('returns seeds and linked items with passages, within the budget, and the edges between them', async () => {
    const out = await retrieve('alpha', { registry, links: links({ [a]: [{ kind: 'resource', direction: 'out', iri: b }, { kind: 'related', direction: 'out', iri: c }] }), config: { ...RAG_CONFIG, passageChars: 100, charBudget: 150 } })
    expect(out.items.map(i => i.label)).toEqual(['Alpha', 'Beta'])
    expect(out.items[0].seed).toBe(true)
    expect(out.items[1].via).toEqual([{ label: 'Alpha', kind: 'resource' }])
    expect(out.items[0].text).toHaveLength(100)
    expect(out.items[1].text).toHaveLength(50)
    expect(out.edges).toEqual([{ from: a, kind: 'resource', to: b }])
  })

  it('works without links, and returns nothing for an empty question', async () => {
    expect((await retrieve('alpha', { registry })).items).toHaveLength(1)
    expect((await retrieve('  ', { registry })).items).toEqual([])
  })
})
