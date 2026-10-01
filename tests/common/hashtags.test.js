import { describe, it, expect, afterEach } from 'vitest'
import { parseHashtags, withAncestors, cleanTag } from '../../src/common/hashtags/parse.js'
import { tagIri, tagOf, conceptTriples, topConceptTriple, schemeTriples, usageTriples } from '../../src/common/hashtags/triples.js'
import { HashtagStore } from '../../src/common/hashtags/HashtagStore.js'
import { LinkStore } from '../../src/common/links/LinkStore.js'
import { renderMarkdown, renderInline } from '../../src/common/ui/markdown.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import FacetRegistry from '../../src/common/facets/FacetRegistry.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'

const DIM = 'http://purl.org/stuff/dim/'

describe('parseHashtags', () => {
  it('finds tags at word boundaries, lower-cased, once each', () => {
    expect(parseHashtags('#Synth and #synth, (#diy) end #music/Synth.\n#a_b-c')).toEqual(['synth', 'diy', 'music/synth', 'a_b-c'])
  })

  it('skips headings, numbers, anchors, URLs and code', () => {
    const md = '# Heading\n## Two\nissue #123 and [x](#top) and https://x.example/p#frag and a#b\n`#code`\n```\n#fenced\n```\n#'
    expect(parseHashtags(md)).toEqual([])
  })

  it('reads unicode tags, trims trailing punctuation, takes several texts', () => {
    expect(parseHashtags('#café-', '#日本語 #x/')).toEqual(['café', '日本語', 'x'])
    expect(parseHashtags(null, undefined)).toEqual([])
    expect(cleanTag('a--b')).toBeNull()
    expect(cleanTag('9')).toBeNull()
    expect(cleanTag('x'.repeat(61))).toBeNull()
  })

  it('lists a nested tag with the tags above it', () => {
    expect(withAncestors('a/b/c')).toEqual(['a', 'a/b', 'a/b/c'])
  })
})

describe('rendering', () => {
  it('links hashtags to their page, but not in code, headings or link targets', () => {
    const html = renderMarkdown('# Title\n\nA #Synth/diy note, [anchor](#top) `#no`\n\nissue #12')
    expect(html).toContain('<a href="/tags/synth%2Fdiy">#Synth/diy</a>')
    expect(html).not.toContain('/tags/no')
    expect(html).not.toContain('/tags/12')
    expect(html).toContain('<a href="#top">anchor</a>')
    expect(renderInline('Buy #milk')).toBe('Buy <a href="/tags/milk">#milk</a>')
  })
})

describe('SKOS triples', () => {
  it('names concepts by tag, and back', () => {
    expect(tagIri('music/synth')).toBe(`${DIM}concept/tag-music--synth`)
    expect(tagOf(tagIri('music/synth'))).toBe('music/synth')
    expect(tagOf(`${DIM}concept/topic-x`)).toBeNull()
  })

  it('makes concepts the shapes accept, with nesting as skos:broader', async () => {
    const validator = await ShapeValidator.load()
    const top = conceptTriples('music')
    const nested = conceptTriples('music/synth')
    expect(nested.join('\n')).toContain(`<http://www.w3.org/2004/02/skos/core#broader> <${tagIri('music')}>`)
    expect(top.join('\n')).not.toContain('broader')
    expect(topConceptTriple('music')).toContain('hasTopConcept')
    for (const triples of [top, nested, schemeTriples()]) expect((await validator.validateTriples(triples)).conforms).toBe(true)
    expect(usageTriples(`${DIM}page/x`, ['music'])).toEqual([`<${DIM}page/x> <${DIM}hashtag> <${tagIri('music')}> .`])
  })
})

describe('LinkStore.syncHashtags', () => {
  function store ({ concepts = [], has = false } = {}) {
    const calls = []
    const repository = {
      facetGraph: async () => 'graph:facet/links',
      describe: async () => has ? [`<${DIM}page/x> <${DIM}hashtag> <${tagIri('old')}> .`] : [],
      add: async args => calls.push(['add', args]),
      replace: async args => calls.push(['replace', args])
    }
    return { links: new LinkStore({ client: { select: async () => concepts.map(label => ({ label })) }, repository }), calls }
  }

  it('creates the scheme and each new concept with its ancestors, then replaces the uses', async () => {
    const { links, calls } = store()
    await links.syncHashtags({ from: `${DIM}page/x`, tags: ['music/synth', 'music/synth', 'diy'], actor: 'owner' })
    const added = calls.filter(c => c[0] === 'add').map(c => c[1].summary)
    expect(added).toEqual(['hashtag scheme', 'hashtag #music', 'top hashtag #music', 'hashtag #music/synth', 'hashtag #diy', 'top hashtag #diy'])
    const replace = calls.at(-1)[1]
    expect(replace).toMatchObject({ subject: `${DIM}page/x`, predicates: [`${DIM}hashtag`] })
    expect(replace.triples).toHaveLength(2)
  })

  it('adds only the concepts that are missing, and nothing for a text that never had tags', async () => {
    const known = store({ concepts: ['music', 'diy'] })
    await known.links.syncHashtags({ from: `${DIM}page/x`, tags: ['music/synth', 'diy'], actor: 'owner' })
    expect(known.calls.filter(c => c[0] === 'add').map(c => c[1].summary)).toEqual(['hashtag #music/synth'])

    const none = store()
    await none.links.syncHashtags({ from: `${DIM}page/x`, tags: [], actor: 'owner' })
    expect(none.calls).toEqual([])
    const had = store({ has: true })
    await had.links.syncHashtags({ from: `${DIM}page/x`, tags: [], actor: 'owner' })
    expect(had.calls).toEqual([['replace', expect.objectContaining({ triples: [] })]])
  })
})

const registry = new FacetRegistry([
  { id: 'wiki', label: 'Wiki', routes () {}, types: { page: '/wiki/page/' }, lookup: iri => ({ label: iri.split('/').pop(), href: `/wiki/page/${iri.split('/').pop()}`, type: 'page' }), tags: () => new Map([['synth', 1]]) }
])

describe('HashtagStore', () => {
  const client = {
    select: async (q) => {
      if (/hashtag \?concept/.test(q) && !q.includes('broader*')) return [{ s: `${DIM}page/a`, label: 'synth' }, { s: `${DIM}page/a`, label: 'synth' }, { s: `${DIM}page/b`, label: 'diy' }]
      if (q.includes('broader*')) return [{ s: `${DIM}page/a` }, { s: `${DIM}page/c` }]
      return [{ label: 'music', broader: undefined }, { label: 'music/synth', broader: 'music' }, { label: 'music/diy', broader: 'music' }]
    }
  }
  const store = new HashtagStore({ client })

  it('folds hashtag uses into the tag counts, once per resource', async () => {
    const tags = await store.addCounts([{ tag: 'synth', count: 1, facets: ['Wiki'] }], registry)
    expect(tags).toEqual([{ tag: 'synth', count: 2, facets: ['Wiki'] }, { tag: 'diy', count: 1, facets: ['Wiki'] }])
  })

  it('adds the resources under a tag to what facets report, without repeats', async () => {
    const groups = [{ facet: 'wiki', label: 'Wiki', results: [{ iri: `${DIM}page/a`, label: 'a', href: '/wiki/page/a' }] }]
    await store.addTagged(groups, 'music', registry)
    expect(groups[0].results.map(r => r.iri)).toEqual([`${DIM}page/a`, `${DIM}page/c`])
    expect(groups[0].results[1].snippet).toBe('hashtag')
  })

  it('knows what is above and below a tag', async () => {
    expect(await store.family('music')).toEqual({ broader: null, narrower: ['music/diy', 'music/synth'] })
    expect(await store.family('music/synth')).toEqual({ broader: 'music', narrower: [] })
  })
})

describe('/tags with hashtags', () => {
  const TOKEN = 'test-token-0123456789abcdef'
  let server
  afterEach(() => new Promise(resolve => server ? server.close(resolve) : resolve()))
  async function listen (hashtags) {
    const facet = { id: 'wiki', label: 'Wiki', routes () {}, types: { page: '/wiki/page/' }, lookup: iri => ({ label: 'A', href: '/wiki/page/a', type: 'page' }), tags: () => new Map([['x', 1]]) }
    server = createServer({ facets: [facet], defaultFacet: 'wiki', services: { auth: new Auth({ token: TOKEN }), hashtags } })
    await new Promise(resolve => server.listen(0, resolve))
    return `http://localhost:${server.address().port}`
  }
  const hashtags = {
    addCounts: async tags => [...tags, { tag: 'music/synth', count: 1, facets: ['Wiki'] }],
    addTagged: async groups => groups,
    family: async () => ({ broader: 'music', narrower: ['music/synth/poly'] })
  }

  it('lists hashtags with the facets\' tags and shows a tag under its parent', async () => {
    const base = await listen(hashtags)
    const list = await (await fetch(`${base}/tags.json`)).json()
    expect(list.tags.map(t => t.tag)).toEqual(['x', 'music/synth'])
    const page = await (await fetch(`${base}/tags/music%2Fsynth`)).text()
    expect(page).toContain('Tagged “music/synth”')
    expect(page).toContain('Under <a href="/tags/music">#music</a>')
    expect(page).toContain('href="/tags/music%2Fsynth%2Fpoly"')
    const json = await (await fetch(`${base}/tags/music%2Fsynth.json`)).json()
    expect(json).toMatchObject({ tag: 'music/synth', broader: 'music' })
  })

  it('falls back to the facets\' own tags when hashtags are missing or the store fails', async () => {
    let base = await listen(null)
    expect((await (await fetch(`${base}/tags.json`)).json()).tags.map(t => t.tag)).toEqual(['x'])
    await new Promise(resolve => server.close(resolve))
    base = await listen({ addCounts: async () => { throw new Error('down') }, addTagged: async () => { throw new Error('down') }, family: async () => { throw new Error('down') } })
    expect((await (await fetch(`${base}/tags.json`)).json()).tags.map(t => t.tag)).toEqual(['x'])
    expect((await fetch(`${base}/tags/x`)).status).toBe(200)
  })
})
