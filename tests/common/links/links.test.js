import { describe, it, expect } from 'vitest'
import { parseMentions, toIri, resolveMentions, typeSlugOf, iriFor } from '../../../src/common/links/mentions.js'
import { renderMarkdown } from '../../../src/common/ui/markdown.js'
import { LinkStore } from '../../../src/common/links/LinkStore.js'
import FacetRegistry from '../../../src/common/facets/FacetRegistry.js'

const DIM = 'http://purl.org/stuff/dim/'

const registry = new FacetRegistry([{
  id: 'gnamgnam',
  label: 'GnamGnam',
  routes () {},
  types: { bookmark: '/gnamgnam/bookmark/' },
  lookup: iri => iri === `${DIM}bookmark/a-1` ? { label: 'A one', href: '/gnamgnam/bookmark/a-1', type: 'bookmark' } : null,
  lookupUrl: url => url.startsWith('https://a.example') ? `${DIM}bookmark/a-1` : null,
  lookupTitle: t => t.toLowerCase() === 'a one' ? `${DIM}bookmark/a-1` : null,
  find: async q => q === 'a' ? [{ iri: `${DIM}bookmark/a-1`, label: 'A one', href: '/gnamgnam/bookmark/a-1' }] : []
}])

describe('mentions', () => {
  it('finds [[type/slug]], [[titles]] and URLs, ignoring code', () => {
    const md = 'See [[bookmark/a-1]], [[A one]] and /r/bookmark/b-2 and https://x.example/p.\n`[[bookmark/no]]`\n```\n[[bookmark/no2]]\n```'
    const { refs, titles, urls } = parseMentions(md)
    expect(refs).toEqual([{ type: 'bookmark', slug: 'a-1' }])
    expect(titles).toEqual(['A one'])
    expect(urls).toEqual(['/r/bookmark/b-2', 'https://x.example/p'])
  })

  it('turns what was typed or pasted into an IRI', () => {
    const opts = { registry, origin: 'http://localhost:4110' }
    expect(toIri('[[bookmark/a-1]]', opts)).toBe(`${DIM}bookmark/a-1`)
    expect(toIri('bookmark/a-1', opts)).toBe(`${DIM}bookmark/a-1`)
    expect(toIri('/r/task/t-9', opts)).toBe(`${DIM}task/t-9`)
    expect(toIri('/gnamgnam/bookmark/a-1.ttl', opts)).toBe(`${DIM}bookmark/a-1`)
    expect(toIri('http://localhost:4110/gnamgnam/bookmark/a-1?x', opts)).toBe(`${DIM}bookmark/a-1`)
    expect(toIri('https://a.example/page', opts)).toBe(`${DIM}bookmark/a-1`)
    expect(toIri('https://elsewhere.example/', opts)).toBe('https://elsewhere.example/')
    expect(toIri(`${DIM}bookmark/a-1`, opts)).toBe(`${DIM}bookmark/a-1`)
    for (const bad of ['', 'just words', '//evil.example/x', 'javascript:alert(1)', `${DIM}not a slug`]) expect(toIri(bad, opts), bad).toBeNull()
  })

  it('resolves a note to the DIM resources it mentions', async () => {
    const targets = await resolveMentions('[[bookmark/b-2]] [[A one]] https://a.example/x https://other.example [[Nobody]]', { registry })
    expect(targets).toEqual([`${DIM}bookmark/b-2`, `${DIM}bookmark/a-1`])
    expect(typeSlugOf(iriFor('task', 'x-1'))).toEqual({ type: 'task', slug: 'x-1' })
  })
})

describe('renderMarkdown', () => {
  it('escapes raw HTML and unsafe links, and links [[references]]', () => {
    const html = renderMarkdown('<script>x</script>\n\nText <b onclick="x">b</b> [a](javascript:alert(1)) [b](https://ok.example) [[bookmark/a-1]] [[A one]] ![i](data:x)')
    expect(html).not.toMatch('<script>')
    expect(html).not.toMatch('<b ')
    expect(html).toMatch('&lt;script&gt;')
    expect(html).not.toMatch('href="javascript')
    expect(html).not.toMatch('href="data')
    expect(html).toMatch('<a href="https://ok.example">b</a>')
    expect(html).toMatch('<a href="/r/bookmark/a-1">bookmark/a-1</a>')
    expect(html).toMatch('<a href="/find?q=A%20one">A one</a>')
  })
})

describe('FacetRegistry resolution', () => {
  it('maps IRIs to pages and back', async () => {
    expect(registry.href(`${DIM}bookmark/a-1`)).toBe('/gnamgnam/bookmark/a-1')
    expect(registry.href(`${DIM}task/t-1`)).toBeNull()
    expect(registry.iriFromPath('/gnamgnam/bookmark/a-1')).toBe(`${DIM}bookmark/a-1`)
    expect(await registry.lookup(`${DIM}bookmark/a-1`)).toMatchObject({ label: 'A one', facetLabel: 'GnamGnam' })
    expect(await registry.lookup('https://x.example/')).toMatchObject({ label: 'https://x.example/', href: 'https://x.example/' })
    expect(await registry.find('a')).toEqual([{ facet: 'gnamgnam', label: 'GnamGnam', results: [expect.objectContaining({ label: 'A one' })] }])
  })

  it('refuses two facets claiming one type', () => {
    const f = id => ({ id, label: id, routes () {}, types: { bookmark: `/${id}/` } })
    expect(() => new FacetRegistry([f('a'), f('b')])).toThrow(/claimed by two/)
  })
})

describe('LinkStore', () => {
  function store (rows = []) {
    const calls = []
    const repository = {
      facetGraph: async () => 'graph:facet/links',
      add: async args => calls.push(['add', args]),
      remove: async args => calls.push(['remove', args]),
      replace: async args => calls.push(['replace', args])
    }
    const client = { select: async () => rows }
    return { links: new LinkStore({ client, repository }), calls }
  }

  it('adds typed links and refuses self-links and hand-made mentions', async () => {
    const { links, calls } = store()
    await links.add({ from: `${DIM}bookmark/a`, kind: 'resource', to: `${DIM}bookmark/b`, actor: 'owner' })
    expect(calls[0][1].triples).toEqual([`<${DIM}bookmark/a> <${DIM}resource> <${DIM}bookmark/b> .`])
    await expect(links.add({ from: 'urn:a', kind: 'related', to: 'urn:a' })).rejects.toThrow(/itself/)
    await expect(links.add({ from: 'urn:a', kind: 'mentions', to: 'urn:b' })).rejects.toThrow(/derived/)
    await expect(links.add({ from: 'urn:a', kind: 'likes', to: 'urn:b' })).rejects.toThrow(/derived|Unknown/)
  })

  it('replaces mentions wholesale, without duplicates or self', async () => {
    const { links, calls } = store()
    await links.syncMentions({ from: 'urn:a', targets: ['urn:b', 'urn:b', 'urn:a', 'urn:c'], actor: 'owner' })
    expect(calls[0][0]).toBe('replace')
    expect(calls[0][1].triples).toHaveLength(2)
  })

  it('reads links both ways, showing related once', async () => {
    const { links } = store([
      { p: `${DIM}relatedTo`, other: 'urn:b', direction: 'in' },
      { p: `${DIM}relatedTo`, other: 'urn:b', direction: 'out' },
      { p: `${DIM}resource`, other: 'urn:c', direction: 'in' }
    ])
    expect(await links.linksOf('urn:a')).toEqual([
      { kind: 'related', direction: 'out', iri: 'urn:b' },
      { kind: 'resource', direction: 'in', iri: 'urn:c' }
    ])
  })
})
