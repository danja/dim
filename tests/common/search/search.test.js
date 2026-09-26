import { describe, it, expect } from 'vitest'
import SearchService from '../../../src/common/search/SearchService.js'
import { bookmarkSearchAdapter } from '../../../src/gnamgnam/BookmarkSearch.js'

const DIM = 'http://purl.org/stuff/dim/'

const ROWS = [
  { bookmark: `${DIM}bookmark/synth-1`, g: 'g1', url: 'https://example.com/synth', linkText: 'Modular synth DIY', domain: 'example.com', bookmarkTypes: 'webpage', tags: '', keywords: 'synth, diy' },
  { bookmark: `${DIM}bookmark/rdf-2`, g: 'g1', url: 'https://github.com/a/rdf', linkText: 'RDF toolkit', domain: 'github.com', bookmarkTypes: 'github-repo', tags: '', keywords: '' }
]

function stubClient ({ filtered = [] } = {}) {
  const seen = []
  return {
    seen,
    async select (query) {
      seen.push(query)
      if (query.includes('GROUP_CONCAT')) return ROWS
      if (query.includes('SELECT DISTINCT ?bookmark')) return filtered.map(bookmark => ({ bookmark }))
      return []
    }
  }
}

function service (client) {
  return new SearchService({
    client,
    index: { size: 0 },
    embeddings: {},
    adapter: bookmarkSearchAdapter,
    registry: { async list () { return [{ graph: 'g1', identifier: 'workflowy', licence: 'CC0-1.0' }] } }
  })
}

describe('SearchService with the bookmark adapter', () => {
  it('requires an adapter', () => {
    expect(() => new SearchService({ client: {}, index: {}, embeddings: {} })).toThrow(/adapter/)
  })

  it('loads documents through the adapter', async () => {
    const search = service(stubClient())
    expect(await search.loadDocuments()).toBe(2)
    const doc = search.documents.get(`${DIM}bookmark/synth-1`)
    expect(doc.name).toBe('Modular synth DIY')
    expect(doc.keywords).toEqual(['synth', 'diy'])
    expect(doc.provenance.source).toBe('workflowy')
  })

  it('ranks lexical matches without vectors', async () => {
    const search = service(stubClient())
    await search.loadDocuments()
    const { results, total } = await search.search('modular synth')
    expect(total).toBe(1)
    expect(results[0].iri).toBe(`${DIM}bookmark/synth-1`)
  })

  it('applies facet filters via the adapter conditions', async () => {
    const client = stubClient({ filtered: [`${DIM}bookmark/rdf-2`] })
    const search = service(client)
    await search.loadDocuments()
    const { results } = await search.browse({ facets: { bookmarkType: 'github-repo' } })
    expect(results.map(r => r.iri)).toEqual([`${DIM}bookmark/rdf-2`])
    expect(client.seen.at(-1)).toMatch(`<${DIM}concept/github-repo>`)
  })

  it('adapter emits no conditions for empty facets', () => {
    expect(bookmarkSearchAdapter.filterConditions({})).toEqual([])
  })
})
