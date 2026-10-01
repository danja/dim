import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import { createFacets } from '../../../src/facets.js'
import Auth from '../../../src/common/http/auth.js'
import LexicalIndex from '../../../src/common/search/LexicalIndex.js'

const TOKEN = 'test-token-0123456789abcdef'
const DIM = 'http://purl.org/stuff/dim/'
const IRI = `${DIM}bookmark/foo-12345678`

function stubSearch () {
  const doc = { iri: IRI, url: 'https://example.com/foo', name: 'Foo', bookmarkTypes: ['webpage'], sourceTags: ['example.com'], userTags: [], tags: ['example.com'], note: null, linkStatus: 'ok' }
  const documents = new Map([[IRI, doc]])
  return {
    doc,
    documents,
    index: { size: 0 },
    lexical: new LexicalIndex(),
    async search () { return { results: [...documents.values()], total: documents.size, signals: {} } },
    async browse () { return { results: [...documents.values()], total: documents.size } },
    async facets () { return {} }
  }
}

function stubServices () {
  const calls = []
  return {
    calls,
    auth: new Auth({ token: TOKEN }),
    repository: {
      facetGraph: async id => `graph:facet/${id}`,
      replace: async args => { calls.push(['replace', args]); return args }
    },
    links: {
      syncMentions: async args => calls.push(['mentions', args]),
      syncHashtags: async args => calls.push(['hashtags', args]),
      add: async args => calls.push(['add', args]),
      remove: async args => calls.push(['remove', args]),
      linksOf: async () => []
    }
  }
}

let servers = []
async function listen () {
  const search = stubSearch()
  const services = stubServices()
  const server = createServer({ facets: createFacets({ search }), defaultFacet: 'gnamgnam', services })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, search, services }
}

afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

const json = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...extra }, body: JSON.stringify(body) })

describe('write routes', () => {
  it('saves tags and a note, syncs mentions and updates search at once', async () => {
    const { base, search, services } = await listen()
    const response = await fetch(`${base}/gnamgnam/bookmark/foo-12345678/annotations`, json({ tags: 'Synth, DIY', note: 'See [[bookmark/bar-1]]' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, tags: ['synth', 'diy'], mentions: [`${DIM}bookmark/bar-1`] })
    const [, replace] = services.calls.find(c => c[0] === 'replace')
    expect(replace).toMatchObject({ graph: 'graph:facet/gnamgnam', subject: IRI, actor: 'owner' })
    expect(search.doc.tags).toEqual(['example.com', 'synth', 'diy'])
    expect(search.doc.note).toBe('See [[bookmark/bar-1]]')
  })

  it('sends a form without credentials to the login page', async () => {
    const { base } = await listen()
    const response = await fetch(`${base}/gnamgnam/bookmark/foo-12345678/annotations`, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'tags=x'
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/login?return=%2Fgnamgnam%2Fbookmark%2Ffoo-12345678%2Fannotations')
  })

  it('logs in with the token, and then needs the form token', async () => {
    const { base } = await listen()
    const bad = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=nope&_return=/x' })
    expect(bad.status).toBe(401)
    const good = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${TOKEN}&_return=/gnamgnam/` })
    expect(good.status).toBe(303)
    expect(good.headers.get('location')).toBe('/gnamgnam/')
    const cookie = good.headers.get('set-cookie').split(';')[0]
    const page = await (await fetch(`${base}/gnamgnam/bookmark/foo-12345678`, { headers: { cookie, Accept: 'text/html' } })).text()
    expect(page).toMatch('Edit tags and note')
    const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1]
    const post = (body) => fetch(`${base}/gnamgnam/bookmark/foo-12345678/annotations`, { method: 'POST', redirect: 'manual', headers: { cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    expect((await post('tags=x')).status).toBe(403)
    const ok = await post(`tags=x&_csrf=${encodeURIComponent(csrf)}&_return=/gnamgnam/bookmark/foo-12345678`)
    expect(ok.status).toBe(303)
    expect(ok.headers.get('location')).toBe('/gnamgnam/bookmark/foo-12345678')
  })

  it('reports shape and input errors as 4xx with reasons', async () => {
    const { base, services } = await listen()
    services.repository.replace = async () => { throw Object.assign(new Error('Rejected by the shapes: x'), { status: 422, violations: ['x'] }) }
    const response = await fetch(`${base}/gnamgnam/bookmark/foo-12345678/annotations`, json({ tags: 'a' }))
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ violations: ['x'] })
    const tooMany = await fetch(`${base}/gnamgnam/bookmark/foo-12345678/annotations`, json({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }))
    expect(tooMany.status).toBe(400)
  })

  it('adds links from a pasted page URL, and refuses nonsense', async () => {
    const { base, services } = await listen()
    const ok = await fetch(`${base}/links`, json({ from: '/gnamgnam/bookmark/foo-12345678', kind: 'resource', to: 'https://elsewhere.example/x' }))
    expect(ok.status).toBe(200)
    expect(services.calls.find(c => c[0] === 'add')[1]).toMatchObject({ from: IRI, to: 'https://elsewhere.example/x', kind: 'resource' })
    const bad = await fetch(`${base}/links`, json({ from: IRI, to: 'just words' }))
    expect(bad.status).toBe(400)
  })

  it('reads stay open; writes are off without a token', async () => {
    const search = stubSearch()
    const server = createServer({ facets: createFacets({ search }), defaultFacet: 'gnamgnam' })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`
    expect((await fetch(`${base}/health`).then(r => r.json())).writes).toBe('disabled')
    const response = await fetch(`${base}/links`, json({ from: IRI, to: IRI }))
    expect(response.status).toBe(403)
    expect((await response.json()).error).toMatch(/DIM_WRITE_TOKEN/)
  })
})

describe('find and resolve', () => {
  it('finds across facets and resolves /r links', async () => {
    const { base } = await listen()
    const found = await (await fetch(`${base}/find.json?q=foo`)).json()
    expect(found.groups[0]).toMatchObject({ facet: 'gnamgnam', results: [expect.objectContaining({ label: 'Foo', href: '/gnamgnam/bookmark/foo-12345678' })] })
    const r = await fetch(`${base}/r/bookmark/foo-12345678`, { redirect: 'manual' })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/gnamgnam/bookmark/foo-12345678')
    expect((await fetch(`${base}/r/task/nope`, { redirect: 'manual' })).status).toBe(404)
    expect((await fetch(`${base}/find?q=foo`)).headers.get('content-type')).toMatch('text/html')
  })
})
