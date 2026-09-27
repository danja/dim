import { describe, it, expect, afterEach } from 'vitest'
import { dayRange, weekStart, activity, week } from '../../src/common/journal/journal.js'
import QueryService from '../../src/common/store/QueryService.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

const P = 'http://purl.org/stuff/dim/'
const TOKEN = 'test-token-0123456789abcdef'

async function setup () {
  const { store: wiki } = memoryWiki()
  const page = await wiki.save({ title: 'Synth notes', content: 'x', actor: 'o' })
  const docs = new Map([[`${P}bookmark/b1`, { iri: `${P}bookmark/b1`, name: 'Filter kit', url: 'https://e.org', linkStatus: 'ok', userTags: [] }]])
  const rows = [
    { resource: page.iri, at: '2026-09-22T09:00:00Z', action: 'update', actor: 'owner', summary: 'new page' },
    { resource: page.iri, at: '2026-09-22T11:30:00Z', action: 'update', actor: 'owner', summary: 'edit (r2)' },
    { resource: `${P}bookmark/b1`, at: '2026-09-22T12:00:00Z', action: 'add', actor: 'owner', summary: 'bookmark saved: Filter kit' },
    { resource: `${P}task/gone`, at: '2026-09-22T13:00:00Z', action: 'update', actor: 'owner', summary: 'todo → done' }
  ]
  const client = {
    queries: [],
    async select (q) {
      this.queries.push(q)
      const m = q.match(/>= "([^"]+)"\^\^[^ ]+ && \?at < "([^"]+)"/)
      return m ? rows.filter(r => r.at >= m[1] && r.at < m[2]) : []
    }
  }
  const facets = [createGnamgnamFacet({ search: { documents: docs, index: { size: 0 }, async facets () { return {} } } }), createWikiFacet({ store: wiki })]
  return { client, facets, page }
}

describe('journal', () => {
  it('knows days and weeks', () => {
    expect(dayRange('2026-09-22')).toEqual({ from: new Date('2026-09-22T00:00:00Z'), to: new Date('2026-09-23T00:00:00Z') })
    expect(dayRange('2026-9-22')).toBeNull()
    expect(weekStart('2026-09-27')).toBe('2026-09-21') // a Sunday → its Monday
    expect(weekStart('2026-09-21')).toBe('2026-09-21')
  })

  it('collapses a day’s changes per resource and drops what no longer exists', async () => {
    const { client, facets, page } = await setup()
    const { FacetRegistry } = await import('../../src/common/facets/FacetRegistry.js')
    const registry = new FacetRegistry(facets)
    const { entries } = await activity({ client, queries: new QueryService(), registry, ...dayRange('2026-09-22') })
    expect(entries.map(e => [e.label, e.first, e.last, e.summaries])).toEqual([
      ['Synth notes', '2026-09-22T09:00:00Z', '2026-09-22T11:30:00Z', ['new page', 'edit (r2)']],
      ['Filter kit', '2026-09-22T12:00:00Z', '2026-09-22T12:00:00Z', ['bookmark saved: Filter kit']]
    ])
    expect(entries[0].href).toBe(`/wiki/page/${page.slug}`)
    const days = await week({ start: '2026-09-21', client, queries: new QueryService(), registry })
    expect(days.map(d => d.total)).toEqual([0, 2, 0, 0, 0, 0, 0])
    expect(days[1].highlights.page.map(e => e.label)).toEqual(['Synth notes'])
    expect(days[1].highlights.bookmark.map(e => e.label)).toEqual(['Filter kit'])
  })
})

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('/day and /week', () => {
  it('are the owner’s', async () => {
    const { client, facets } = await setup()
    const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({ token: TOKEN }), repository: { client } } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`
    expect((await fetch(`${base}/day/2026-09-22`, { redirect: 'manual' })).status).toBe(303)
    const day = await (await fetch(`${base}/day/2026-09-22`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(day).toContain('Tuesday, 22 September 2026')
    expect(day).toMatch(/Wiki <small class="meta">1<\/small>[\s\S]*09:00–11:30<\/time> <a href="\/wiki\/page\/synth-notes">Synth notes/)
    expect(day).toContain('href="/day/2026-09-23"')
    const wk = await (await fetch(`${base}/week/2026-09-24`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(wk).toContain('Week of Monday, 21 September 2026')
    expect(wk).toMatch(/Wiki pages started <small class="meta">1<\/small>/)
    expect((await fetch(`${base}/day/2026-13-45`, { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(400)
  })
})
