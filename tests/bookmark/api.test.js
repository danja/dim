import { describe, it, expect, afterEach } from 'vitest'
import QueryService from '../../src/store/QueryService.js'
import { createServer, negotiate, bookmarkDataUrl } from '../../src/api/server.js'

const DOC = {
  iri: 'http://purl.org/stuff/dim/bookmark/foo-12345678',
  url: 'https://example.com/foo',
  linkText: 'Foo',
  name: 'Foo',
  title: null,
  description: 'A foo page.',
  domain: 'example.com',
  bookmarkTypes: ['webpage'],
  tags: []
}

function stubSearch (docs, { turtle = null, constructThrows = false } = {}) {
  return {
    documents: new Map(docs.map(d => [d.iri, d])),
    index: { size: 0 },
    async search () { return { results: docs, total: docs.length, signals: {} } },
    async browse () { return { results: docs, total: docs.length } },
    async facets () { return {} },
    queries: new QueryService(),
    client: {
      async construct () {
        if (constructThrows) throw new Error('store down')
        return turtle
      }
    }
  }
}

let servers = []
async function listen (search) {
  const server = createServer({ search })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return `http://localhost:${server.address().port}`
}

afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('bookmark data links', () => {
  it('builds a .ttl url from the bookmark iri', () => {
    expect(bookmarkDataUrl(DOC)).toBe('/bookmark/foo-12345678.ttl')
    expect(bookmarkDataUrl({ iri: 'http://example.com/other' })).toBeNull()
    expect(bookmarkDataUrl(null)).toBeNull()
  })

  it('search page has a data link per result', async () => {
    const base = await listen(stubSearch([DOC]))
    const html = await (await fetch(`${base}/?q=foo`)).text()
    expect(html).toMatch('<a href="/bookmark/foo-12345678.ttl">data</a>')
  })

  it('search json carries a data url per result', async () => {
    const base = await listen(stubSearch([DOC]))
    const body = await (await fetch(`${base}/search?q=foo`)).json()
    expect(body.results[0].data).toBe('/bookmark/foo-12345678.ttl')
  })

  it('serves the saved turtle from the store', async () => {
    const saved = '<http://purl.org/stuff/dim/bookmark/foo-12345678> <http://purl.org/stuff/dim/summary> "Saved summary." .'
    const base = await listen(stubSearch([DOC], { turtle: saved }))
    const response = await fetch(`${base}/bookmark/foo-12345678.ttl`)
    expect(response.headers.get('content-type')).toMatch('text/turtle')
    expect(await response.text()).toBe(saved)
  })

  it('falls back to the in-memory turtle when the store cannot answer', async () => {
    const base = await listen(stubSearch([DOC], { constructThrows: true }))
    const text = await (await fetch(`${base}/bookmark/foo-12345678.ttl`)).text()
    expect(text).toMatch('dim:Bookmark')
    expect(text).toMatch('https://example.com/foo')
  })

  it('404s unknown bookmarks', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/bookmark/nope-00000000.ttl`)
    expect(response.status).toBe(404)
  })

  it('negotiate still routes suffixes and accept headers', () => {
    expect(negotiate('.ttl')).toBe('turtle')
    expect(negotiate(undefined, 'text/turtle')).toBe('turtle')
    expect(negotiate(undefined, 'text/html')).toBe('html')
  })
})
