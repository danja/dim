import { describe, it, expect, afterEach } from 'vitest'
import { classify, capture, CaptureError } from '../../src/squirt/capture.js'
import { manifest } from '../../src/squirt/pwa.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { createSquirtFacet } from '../../src/squirt/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

describe('classify', () => {
  it('routes by content', () => {
    expect(classify({ text: 'todo call Ann\nabout the synth' })).toEqual({ kind: 'task', url: null, title: 'call Ann', note: 'about the synth' })
    expect(classify({ text: 'Task: fix the bike' }).title).toBe('fix the bike')
    expect(classify({ text: '- [ ] buy glue' })).toMatchObject({ kind: 'task', title: 'buy glue' })
    expect(classify({ text: 'https://e.org/a, great read' })).toEqual({ kind: 'bookmark', url: 'https://e.org/a', title: 'great read', note: null })
    expect(classify({ text: 'Look at this', url: 'https://e.org/b', title: 'Shared page' })).toEqual({ kind: 'bookmark', url: 'https://e.org/b', title: 'Shared page', note: 'Look at this' })
    expect(classify({ text: 'Android puts it in text https://e.org/c.' })).toMatchObject({ kind: 'bookmark', url: 'https://e.org/c', title: 'Android puts it in text' })
    expect(classify({ text: 'An idea about oscillators\nmore detail' })).toEqual({ kind: 'note', url: null, title: 'An idea about oscillators', note: 'more detail' })
  })

  it('lets the chosen kind win, and refuses nothing', () => {
    expect(classify({ text: 'https://e.org/d read later', kind: 'task' })).toMatchObject({ kind: 'task', title: 'https://e.org/d read later' })
    expect(classify({ text: 'todo https://e.org/x' })).toMatchObject({ kind: 'task', url: 'https://e.org/x' })
    expect(() => classify({ text: '   ' })).toThrow(CaptureError)
    expect(() => classify({ text: 'no link', kind: 'bookmark' })).toThrow('needs a URL')
  })
})

describe('capture', () => {
  it('adds notes to the top of the wiki Inbox', async () => {
    const { store: wiki } = memoryWiki()
    const now = () => new Date('2026-09-26T09:30:00Z')
    const first = await capture(classify({ text: 'First thought' }), { wiki, actor: 'owner', now })
    expect(first).toMatchObject({ kind: 'note', href: '/wiki/page/inbox' })
    await capture(classify({ text: 'Second thought\nwith [[Links]]' }), { wiki, actor: 'owner', now })
    const inbox = await wiki.byTitle('Inbox')
    expect(inbox.revision).toBe(2)
    expect(inbox.content).toBe('## 2026-09-26 09:30\n\nSecond thought\n\nwith [[Links]]\n\n## 2026-09-26 09:30\n\nFirst thought')
  })

  it('makes tasks and bookmarks', async () => {
    const made = []
    const tasks = { async create (f) { made.push(f); return { id: 't1', iri: 'http://purl.org/stuff/dim/task/t1', title: f.title } } }
    expect(await capture(classify({ text: 'todo x' }), { tasks, actor: 'owner' })).toEqual({ kind: 'task', iri: 'http://purl.org/stuff/dim/task/t1', href: '/farelo/task/t1', label: 'x' })
    expect(made[0]).toMatchObject({ title: 'x', status: 'todo', tags: ['squirt'] })

    const adds = []
    const client = { async ask () { return false } }
    const repository = { async facetGraph () { return 'graph:facet/gnamgnam' }, async add (c) { adds.push(c) } }
    const registry = { refreshed: [], async refresh (i) { this.refreshed.push(i) }, href: () => '/gnamgnam/bookmark/x' }
    const done = await capture(classify({ text: 'https://e.org/z nice' }), { client, repository, registry, actor: 'owner' })
    expect(done).toMatchObject({ kind: 'bookmark', href: '/gnamgnam/bookmark/x', existed: false })
    expect(adds[0].triples.join('\n')).toContain('"squirt"')
    expect(registry.refreshed).toEqual([done.iri])
  })
})

describe('app shell', () => {
  it('describes an installable app with a share target', () => {
    const m = manifest()
    expect(m).toMatchObject({ start_url: '/squirt/', scope: '/', display: 'standalone', share_target: { action: '/squirt/share', method: 'GET' } })
    expect(m.icons.map(i => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  })
})

const TOKEN = 'test-token-0123456789abcdef'
let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('squirt routes', () => {
  it('serves the worker, manifest and share page; captures; hides activity from strangers', async () => {
    const { store: wiki } = memoryWiki()
    const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
    const client = { async select () { return [] }, async ask () { return false } }
    const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store: wiki }), createSquirtFacet({ client, wiki })]
    const server = createServer({ facets, defaultFacet: 'squirt', services: { auth: new Auth({ token: TOKEN }) } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`

    const sw = await fetch(`${base}/squirt/sw.js`)
    expect(sw.headers.get('service-worker-allowed')).toBe('/')
    expect(await sw.text()).toContain("addEventListener('fetch'")
    expect((await (await fetch(`${base}/squirt/manifest.webmanifest`)).json()).name).toBe('DIM')
    expect(await (await fetch(`${base}/wiki/`)).text()).toContain('<link rel="manifest" href="/squirt/manifest.webmanifest">')

    const share = await (await fetch(`${base}/squirt/share?title=A%20page&text=https%3A%2F%2Fe.org%2Fp`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(share).toContain('Guess: <strong>bookmark</strong>')
    expect(share).toContain('value="A page"')
    const anonShare = await (await fetch(`${base}/squirt/share?url=https%3A%2F%2Fe.org%2Fp`)).text()
    expect(anonShare).toContain('/login?return=%2Fsquirt%2Fshare%3Furl%3D')

    expect((await fetch(`${base}/squirt/recent.json`)).status).toBe(401)
    expect(await (await fetch(`${base}/squirt/`)).text()).not.toContain('Lately')

    const saved = await fetch(`${base}/squirt/capture`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ text: 'Remember the [[Dice]] page' }) })
    expect(await saved.json()).toMatchObject({ ok: true, kind: 'note', href: '/wiki/page/inbox' })
  })
})
