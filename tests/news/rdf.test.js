import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import { feedSlug, feedIri, feedTriples, pollTriples, itemTriples, itemId, itemIri } from '../../src/news/rdf.js'

describe('news RDF', () => {
  it('names feeds and items stably', () => {
    expect(feedSlug('https://www.example.org/blog/feed/')).toMatch(/^example-org-blog-[0-9a-f]{8}$/)
    expect(feedSlug('https://example.org/feed')).toBe(feedSlug('https://example.org/feed'))
    expect(itemId('f', 'a')).not.toBe(itemId('f', 'b'))
    expect(itemId('f', 'a')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('writes feeds and items that pass SHACL', async () => {
    const validator = await ShapeValidator.load()
    const feed = { iri: feedIri('x-1'), url: 'https://x.example/feed', title: 'X', siteUrl: 'https://x.example/', tags: ['synth'], created: '2026-09-01T00:00:00Z', format: 'rss', status: 'ok', lastPolled: '2026-09-02T00:00:00Z', nextPoll: '2026-09-02T01:00:00Z', failures: 0, httpStatus: 200, etag: '"abc"', lastModified: 'Tue, 01 Sep 2026 00:00:00 GMT' }
    expect((await validator.validateTriples([...feedTriples(feed), ...pollTriples(feed)])).conforms).toBe(true)
    expect((await validator.validateTriples([...feedTriples(feed), ...pollTriples({ ...feed, status: 'weird' })])).conforms).toBe(false)

    const id = itemId(feed.iri, 'g1')
    const item = { iri: itemIri(id), feed: feed.iri, title: 'T', guid: 'g1', link: 'https://x.example/1', published: '2026-09-01T00:00:00Z', firstSeen: '2026-09-02T00:00:00Z', summary: 'S', author: 'A', categories: ['c'] }
    expect((await validator.validateTriples(itemTriples(item))).conforms).toBe(true)
    expect((await validator.validateTriples(itemTriples({ ...item, summary: 'x'.repeat(4001) }))).conforms).toBe(false)
  })
})
