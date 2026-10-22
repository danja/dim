import { describe, it, expect } from 'vitest'
import { expand } from '../../../src/common/rag/expand.js'
import { retrieve } from '../../../src/common/rag/retrieve.js'
import { tune } from '../../../src/common/rag/options.js'
import { detectCommunities } from '../../../src/common/rag/detect.js'
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

describe('expand through hashtags', () => {
  const tagged = members => ({ async tagsOfMany (iris) { return new Map(iris.filter(i => i === a).map(i => [i, [{ tag: 'synth', members }]])) } })

  it('joins resources that share a small #tag', async () => {
    const { found, edges } = await expand([{ iri: a, score: 1 }], { links: links({}), hashtags: tagged([a, d]) })
    expect(found.get(d).via[0].kind).toBe('hashtag')
    expect(edges).toContainEqual({ from: a, kind: 'hashtag', to: d })
  })

  it('skips a tag too many use, and honours hashtags off', async () => {
    const crowd = Array.from({ length: 40 }, (_, i) => `${D}m/${i}`)
    expect((await expand([{ iri: a, score: 1 }], { links: links({}), hashtags: tagged(crowd) })).found.size).toBe(1)
    const off = tune([['hashtags', '0']])
    expect((await expand([{ iri: a, score: 1 }], { links: links({}), hashtags: tagged([a, d]), config: off })).found.size).toBe(1)
  })

  it('carries on when the store cannot answer', async () => {
    const broken = { async tagsOfMany () { throw new Error('down') } }
    expect((await expand([{ iri: a, score: 1 }], { links: links({}), hashtags: broken })).found.size).toBe(1)
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

describe('similarity edges', () => {
  it('spread to embedding neighbours only when enabled', async () => {
    const similar = async iri => iri === a ? [{ iri: d, score: 0.8 }] : []
    const off = await expand([{ iri: a, score: 1 }], { links: links({}), similar })
    expect(off.found.has(d)).toBe(false)
    const on = await expand([{ iri: a, score: 1 }], { links: links({}), similar, config: { ...RAG_CONFIG, similarity: { ...RAG_CONFIG.similarity, enabled: true } } })
    expect(on.found.get(d).score).toBeCloseTo(0.56)
    expect(on.found.get(d).via[0].kind).toBe('similar')
  })
})

describe('tune', () => {
  it('overrides by name, clamps, ignores the unknown, and leaves the base alone', () => {
    const config = tune([['hops', '9'], ['similar', ''], ['wRelated', '1.5'], ['communityK', '3'], ['nonsense', '1'], ['fanout', 'x']])
    expect(config.hops).toBe(3)
    expect(config.similarity.enabled).toBe(true)
    expect(config.kindWeights.related).toBe(1.5)
    expect(config.communities.k).toBe(3)
    expect(config.fanout).toBe(RAG_CONFIG.fanout)
    expect(RAG_CONFIG.similarity.enabled).toBe(false)
    expect(tune([['similar', '0']]).similarity.enabled).toBe(false)
  })
})

describe('detectCommunities', () => {
  const e = (x, y) => ({ a: x, b: y })
  it('finds two clusters joined by one bridge, deterministically, dropping tiny ones', () => {
    const clique = names => names.flatMap((n, i) => names.slice(i + 1).map(m => e(n, m)))
    const edges = [...clique(['a', 'b', 'c', 'd']), ...clique(['w', 'x', 'y', 'z']), e('d', 'w'), e('p', 'q')]
    const groups = [...detectCommunities(edges, { minSize: 3 }).values()].map(m => [...m].sort())
    expect(groups).toEqual([['a', 'b', 'c', 'd'], ['w', 'x', 'y', 'z']])
    expect([...detectCommunities(edges).values()]).toEqual([...detectCommunities(edges).values()])
  })
})

describe('retrieve with communities', () => {
  const registry = {
    async find () { return [{ facet: 'wiki', label: 'Wiki', results: [{ iri: a, label: 'Alpha', href: '/a' }] }] },
    async lookup (iri) { return { iri, label: iri.slice(-1), href: `/x/${iri.slice(-1)}`, facet: 'wiki', facetLabel: 'Wiki' } },
    async passage (iri) { return { text: `Text ${iri.slice(-1)}` } }
  }
  const related = { async vectorFor () { return [1, 0] }, async search () { return [] } }
  const index = { size: 1, async refresh () {}, search: () => [{ id: 'k1', summary: 'About things', size: 3, score: 0.8, members: [c, d] }] }

  it('adds the cluster and boosts its members only when enabled', async () => {
    const off = await retrieve('alpha', { registry, related, communities: index })
    expect(off.communities).toEqual([])
    expect(off.items.map(i => i.iri)).toEqual([a])
    const on = await retrieve('alpha', { registry, related, communities: index, config: tune([['communities', '']]) })
    expect(on.communities[0]).toMatchObject({ id: 'k1', summary: 'About things' })
    expect(on.items.map(i => i.iri).sort()).toEqual([a, c, d].sort())
    expect(on.items.find(i => i.iri === c).via).toEqual([{ label: 'cluster', kind: 'community' }])
  })
})
