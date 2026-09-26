import { describe, it, expect, afterEach } from 'vitest'
import QueryService from '../../../src/common/store/QueryService.js'
import { createServer } from '../../../src/server.js'
import { createFacets } from '../../../src/facets.js'
import { negotiate } from '../../../src/common/http/negotiate.js'
import { bookmarkDataUrl } from '../../../src/gnamgnam/api/bookmarkData.js'

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
  const server = createServer({ facets: createFacets({ search }), defaultFacet: 'gnamgnam' })
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
    expect(bookmarkDataUrl(DOC)).toBe('/gnamgnam/bookmark/foo-12345678.ttl')
    expect(bookmarkDataUrl({ iri: 'http://example.com/other' })).toBeNull()
    expect(bookmarkDataUrl(null)).toBeNull()
  })

  it('search page has a data link per result', async () => {
    const base = await listen(stubSearch([DOC]))
    const html = await (await fetch(`${base}/gnamgnam/?q=foo`)).text()
    expect(html).toMatch('<a href="/gnamgnam/bookmark/foo-12345678.ttl">data</a>')
  })

  it('search json carries a data url per result', async () => {
    const base = await listen(stubSearch([DOC]))
    const body = await (await fetch(`${base}/gnamgnam/search?q=foo`)).json()
    expect(body.results[0].data).toBe('/gnamgnam/bookmark/foo-12345678.ttl')
  })

  it('serves the saved turtle from the store', async () => {
    const saved = '<http://purl.org/stuff/dim/bookmark/foo-12345678> <http://purl.org/stuff/dim/summary> "Saved summary." .'
    const base = await listen(stubSearch([DOC], { turtle: saved }))
    const response = await fetch(`${base}/gnamgnam/bookmark/foo-12345678.ttl`)
    expect(response.headers.get('content-type')).toMatch('text/turtle')
    expect(await response.text()).toBe(saved)
  })

  it('falls back to the in-memory turtle when the store cannot answer', async () => {
    const base = await listen(stubSearch([DOC], { constructThrows: true }))
    const text = await (await fetch(`${base}/gnamgnam/bookmark/foo-12345678.ttl`)).text()
    expect(text).toMatch('dim:Bookmark')
    expect(text).toMatch('https://example.com/foo')
  })

  it('404s unknown bookmarks', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/gnamgnam/bookmark/nope-00000000.ttl`)
    expect(response.status).toBe(404)
  })

  it('negotiate still routes suffixes and accept headers', () => {
    expect(negotiate('.ttl')).toBe('turtle')
    expect(negotiate(undefined, 'text/turtle')).toBe('turtle')
    expect(negotiate(undefined, 'text/html')).toBe('html')
  })
})

describe('common routes', () => {
  it('reports health', async () => {
    const base = await listen(stubSearch([DOC]))
    const body = await (await fetch(`${base}/health`)).json()
    expect(body.status).toBe('ok')
    expect(body.facets.gnamgnam).toMatchObject({ status: 'ok', bookmarks: 1, index: 0 })
    expect(body.facets.farelo).toMatchObject({ status: 'planned', phase: 6 })
  })

  it('serves a vocabulary as turtle', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/ns/dim.ttl`)
    expect(response.headers.get('content-type')).toMatch('text/turtle')
    expect(await response.text()).toMatch('dim:Bookmark')
  })

  it('refuses writes', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/gnamgnam/search`, { method: 'POST' })
    expect(response.status).toBe(405)
  })
})

describe('facet shell', () => {
  it('redirects / to the default facet, keeping the query', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/?q=foo`, { redirect: 'manual' })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/gnamgnam/?q=foo')
  })

  it('redirects pre-facet URLs permanently', async () => {
    const base = await listen(stubSearch([DOC]))
    for (const [from, to] of [
      ['/search?q=foo', '/gnamgnam/search?q=foo'],
      ['/facets', '/gnamgnam/facets'],
      ['/bookmarks?limit=5', '/gnamgnam/bookmarks?limit=5'],
      ['/bookmark/foo-12345678.ttl', '/gnamgnam/bookmark/foo-12345678.ttl']
    ]) {
      const response = await fetch(`${base}${from}`, { redirect: 'manual' })
      expect(response.status, from).toBe(301)
      expect(response.headers.get('location'), from).toBe(to)
    }
  })

  it('renders one tab per facet, marking the current one', async () => {
    const base = await listen(stubSearch([DOC]))
    const html = await (await fetch(`${base}/gnamgnam/`)).text()
    expect(html).toMatch('<meta name="viewport"')
    expect(html.match(/<li><a href="\/[a-z-]+\/"/g)).toHaveLength(7)
    expect(html).toMatch('<a href="/gnamgnam/" aria-current="page">GnamGnam</a>')
    expect(html).not.toMatch('<a href="/farelo/" aria-current')
  })

  it('serves a stub page for facets not built yet', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/farelo/`)
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toMatch('<a href="/farelo/" aria-current="page">Farelo</a>')
    expect(html).toMatch('Phase 6')
  })

  it('serves the shared stylesheet', async () => {
    const base = await listen(stubSearch([DOC]))
    const response = await fetch(`${base}/static/css/base.css`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch('text/css')
    expect(await response.text()).toMatch('.tabs')
  })

  it('does not serve files outside the static root', async () => {
    const base = await listen(stubSearch([DOC]))
    for (const path of ['/static/..%2F..%2F..%2Fpackage.json', '/static/%2E%2E/%2E%2E/server.js']) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404)
    }
  })
})

describe('bookmark detail page', () => {
  const RICH = {
    ...DOC,
    linkStatus: 'dead',
    httpStatus: 404,
    archivedAt: 'https://web.archive.org/web/1/https://example.com/foo',
    context: 'Inbox / Synths',
    sourceLine: 42,
    catalogue: { githubOwner: 'o', githubTopic: ['dsp', 'audio'] },
    keywords: ['foo']
  }

  it('serves HTML by default with status, catalogue and outline', async () => {
    const base = await listen(stubSearch([RICH]))
    const response = await fetch(`${base}/gnamgnam/bookmark/foo-12345678`, { headers: { Accept: 'text/html' } })
    expect(response.headers.get('content-type')).toMatch('text/html')
    const html = await response.text()
    expect(html).toMatch('<h1>Foo</h1>')
    expect(html).toMatch('badge-dead')
    expect(html).toMatch('HTTP 404')
    expect(html).toMatch('<a href="https://web.archive.org/web/1/https://example.com/foo">archived copy</a>')
    expect(html).toMatch('<dt>GitHub owner</dt><dd>o</dd>')
    expect(html).toMatch('<dt>Topics</dt><dd>dsp, audio</dd>')
    expect(html).toMatch('<dt>Context</dt><dd>Inbox / Synths</dd>')
    expect(html).toMatch('line 42')
    expect(html).toMatch('aria-current="page">GnamGnam')
  })

  it('still serves JSON by suffix or Accept', async () => {
    const base = await listen(stubSearch([RICH]))
    const bySuffix = await (await fetch(`${base}/gnamgnam/bookmark/foo-12345678.json`)).json()
    expect(bySuffix.linkStatus).toBe('dead')
    const byAccept = await fetch(`${base}/gnamgnam/bookmark/foo-12345678`, { headers: { Accept: 'application/json' } })
    expect(byAccept.headers.get('content-type')).toMatch('application/json')
  })

  it('search results link to details and flag dead links', async () => {
    const base = await listen(stubSearch([RICH]))
    const html = await (await fetch(`${base}/gnamgnam/?q=foo`)).text()
    expect(html).toMatch('<a href="/gnamgnam/bookmark/foo-12345678">details</a>')
    expect(html).toMatch('badge-dead')
  })
})
