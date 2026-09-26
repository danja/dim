import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  catalogueFromUrl, cleanCatalogue, catalogueTriples, catalogueFromRow, ENRICH_CATALOGUE_PREDICATES
} from '../../src/gnamgnam/Catalogue.js'
import { normaliseBookmark } from '../../src/gnamgnam/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../../src/gnamgnam/harvest/BookmarkSerialiser.js'
import { enrichmentTriples, buildEnrichmentPatchQuery } from '../../src/gnamgnam/enrich/Writers.js'
import { GithubApiFetcher, ArxivFetcher } from '../../src/gnamgnam/enrich/Fetchers.js'
import { composeText } from '../../src/gnamgnam/BookmarkText.js'

const DIM = 'http://purl.org/stuff/dim/'
const IRI = `${DIM}bookmark/x-1`

describe('catalogueFromUrl', () => {
  it('reads GitHub owner and repo', () => {
    expect(catalogueFromUrl('https://github.com/VCVRack/Rack')).toEqual({ githubOwner: 'VCVRack', githubRepo: 'Rack' })
    expect(catalogueFromUrl('https://github.com/a/b.git')).toEqual({ githubOwner: 'a', githubRepo: 'b' })
    expect(catalogueFromUrl('https://github.com/tonaljs/tonal/tree/main/x')).toEqual({ githubOwner: 'tonaljs', githubRepo: 'tonal' })
    expect(catalogueFromUrl('https://github.com/danja')).toEqual({})
  })

  it('reads arXiv ids without version or .pdf', () => {
    expect(catalogueFromUrl('https://arxiv.org/abs/2608.26263')).toEqual({ arxivId: '2608.26263' })
    expect(catalogueFromUrl('https://arxiv.org/pdf/2510.24699v2.pdf')).toEqual({ arxivId: '2510.24699' })
    expect(catalogueFromUrl('https://arxiv.org/abs/hep-th/9901001v1')).toEqual({ arxivId: 'hep-th/9901001' })
    expect(catalogueFromUrl('https://arxiv.org/list/cs.AI/recent')).toEqual({})
  })

  it('reads Wikipedia language and decoded title', () => {
    expect(catalogueFromUrl('https://en.wikipedia.org/wiki/Paterson%27s_worms?wprov=sfla1'))
      .toEqual({ wikipediaLanguage: 'en', wikipediaTitle: "Paterson's worms" })
    expect(catalogueFromUrl('https://it.m.wikipedia.org/wiki/Tonnetz')).toEqual({ wikipediaLanguage: 'it', wikipediaTitle: 'Tonnetz' })
    expect(catalogueFromUrl('https://en.wikipedia.org/w/index.php?title=X')).toEqual({})
  })

  it('ignores other sites and junk', () => {
    expect(catalogueFromUrl('https://example.com/github.com/a/b')).toEqual({})
    expect(catalogueFromUrl('not a url')).toEqual({})
  })
})

describe('catalogue values', () => {
  it('cleans types, repeats and unknown keys', () => {
    expect(cleanCatalogue({ githubStars: '42', githubTopic: ['a', 'a', ' b ', ''], nope: 1, githubLanguage: '' }))
      .toEqual({ githubStars: 42, githubTopic: ['a', 'b'] })
    expect(cleanCatalogue({ githubStars: -1 })).toEqual({})
  })

  it('serialises only the requested owner', () => {
    const all = { githubOwner: 'o', githubStars: 7, githubTopic: ['synth'] }
    const enrichOnly = catalogueTriples(IRI, all, { owner: 'enrich' })
    expect(enrichOnly).toHaveLength(2)
    expect(enrichOnly.join('\n')).toMatch('"7"^^<http://www.w3.org/2001/XMLSchema#integer>')
    expect(enrichOnly.join('\n')).not.toMatch('githubOwner')
    expect(catalogueTriples(IRI, all)).toHaveLength(3)
  })

  it('reads text-view rows back', () => {
    expect(catalogueFromRow({ githubStars: '12', arxivAuthor: 'A. One | B. Two', githubOwner: '' }))
      .toEqual({ githubStars: 12, arxivAuthor: ['A. One', 'B. Two'] })
  })
})

describe('catalogue through ingest and enrichment', () => {
  it('normalise adds URL details and serialise writes them', () => {
    const b = normaliseBookmark({ url: 'https://github.com/VCVRack/Rack', linkText: 'Rack' })
    expect(b.catalogue).toEqual({ githubOwner: 'VCVRack', githubRepo: 'Rack' })
    const triples = serialiseBookmark(b, IRI).join('\n')
    expect(triples).toMatch(`<${DIM}githubOwner> "VCVRack"`)
    expect(triples).toMatch(`<${DIM}githubRepo> "Rack"`)
  })

  it('enrichment writes only API-owned details and replaces them', () => {
    const enrichment = { summary: 'S.', catalogue: { githubLanguage: 'C++', githubOwner: 'ignored' } }
    const triples = enrichmentTriples(IRI, enrichment).join('\n')
    expect(triples).toMatch(`<${DIM}githubLanguage> "C++"`)
    expect(triples).not.toMatch('githubOwner')
    const patch = buildEnrichmentPatchQuery('urn:g', IRI, enrichment)
    for (const p of ENRICH_CATALOGUE_PREDICATES) expect(patch).toMatch(`<${p}>`)
    expect(patch).not.toMatch(`<${DIM}githubOwner>`)
  })

  it('composed text gains details only when present', () => {
    const plain = { url: 'https://example.com/', linkText: 'X' }
    expect(composeText({ ...plain, catalogue: {} })).toBe(composeText(plain))
    const text = composeText({ ...plain, catalogue: { githubLanguage: 'Rust', arxivAuthor: ['Ada L'] } })
    expect(text).toMatch('Rust')
    expect(text).toMatch('by Ada L')
  })
})

describe('API fetchers report catalogue details', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GitHub: language, stars, topics; token sent when set', async () => {
    let seen = null
    vi.stubGlobal('fetch', async (url, init) => {
      seen = init.headers
      return new Response(JSON.stringify({ full_name: 'a/b', description: 'd', language: 'C', stargazers_count: 5, topics: ['dsp'] }), { status: 200 })
    })
    const out = await new GithubApiFetcher({ token: 't0k' }).fetch('https://github.com/a/b')
    expect(out.catalogue).toEqual({ githubLanguage: 'C', githubStars: 5, githubTopic: ['dsp'] })
    expect(seen.Authorization).toBe('Bearer t0k')
  })

  it('arXiv: authors and categories', async () => {
    const xml = `<feed><entry><id>x</id><title>Paper T</title>
<id>http://arxiv.org/abs/1</id><summary>Abstract.</summary>
<author><name>Ada Lovelace</name></author><author><name>Alan Turing</name></author>
<category term="cs.AI" scheme="s"/><category term="cs.LG" scheme="s"/></entry></feed>`
    vi.stubGlobal('fetch', async () => new Response(xml, { status: 200 }))
    const out = await new ArxivFetcher().fetch('https://arxiv.org/abs/1')
    expect(out.catalogue).toEqual({ arxivAuthor: ['Ada Lovelace', 'Alan Turing'], arxivCategory: ['cs.AI', 'cs.LG'] })
  })
})
