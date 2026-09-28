import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createNewsFacet } from '../../src/news/index.js'
import Poller from '../../src/news/Poller.js'
import { NEWS_CONFIG } from '../../config/preferences.js'
import { memoryNews, fakeFetch } from './memoryNews.js'

const TOKEN = 'test-token-0123456789abcdef'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }
const rss = fs.readFileSync(new URL('./fixtures/rss2.xml', import.meta.url), 'utf8')

let servers = []
async function listen () {
  const { store, changes } = await memoryNews()
  const { impl } = fakeFetch({
    'https://example.org/': { body: '<html><head><link rel="alternate" type="application/rss+xml" href="/feed/"></head></html>', headers: { 'content-type': 'text/html' } },
    'https://example.org/feed/': { body: rss }
  })
  const poller = new Poller({ store, config: { ...NEWS_CONFIG, perHostIntervalMs: 0 }, fetchImpl: impl, sleep: async () => {} })
  const made = []
  const tasks = { async create (fields) { made.push(fields); return { id: 'tk1', iri: 'http://purl.org/stuff/dim/task/tk1' } } }
  const links = { added: [], async add (l) { this.added.push(l) }, async linksOf () { return [] }, async forget () {} }
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createNewsFacet({ store, poller, tasks, fetchImpl: impl })]
  const server = createServer({ facets, defaultFacet: 'news', services: { auth: new Auth({ token: TOKEN }), links, repository: store.repository } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, store, made, links, changes }
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: AUTH, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }))

describe('news routes', () => {
  it('subscribes from a web page, shows the river, and toggles flags', async () => {
    const { base, store } = await listen()
    const sub = await post(base, '/news/feeds', { url: 'https://example.org/', tags: 'Synth' })
    expect(sub.status).toBe(200)
    expect(sub.json.poll).toEqual({ status: 'ok', fresh: 3 })
    const feed = (await store.feedList())[0]
    expect(feed).toMatchObject({ url: 'https://example.org/feed/', title: 'Synth & Wood', tags: ['synth'] })

    const river = await (await fetch(`${base}/news/`)).text()
    expect(river).toContain('Building a VCO')
    expect(river).toContain('href="https://example.org/2026/09/vco" rel="noopener noreferrer"')
    expect(river).toMatch(/Unread <span class="count">3<\/span>/)

    const { items } = await store.itemList()
    const flags = await post(base, '/news/items/flags', { ids: [items[0].id], read: true, starred: true })
    expect(flags.json.items[0]).toEqual({ id: items[0].id, read: true, starred: true })
    expect((await (await fetch(`${base}/news/items.json?view=starred`)).json()).items).toHaveLength(1)
    expect((await (await fetch(`${base}/news/items.json`)).json()).items).toHaveLength(2)

    // Paging: newest first, then older than the last one shown.
    const page1 = await (await fetch(`${base}/news/items.json?view=all&limit=2`)).json()
    expect(page1.more).toBe(true)
    const last = page1.items.at(-1)
    const page2 = await (await fetch(`${base}/news/items.json?view=all&limit=2&before=${encodeURIComponent(last.published ?? last.firstSeen)}`)).json()
    expect(page2.items.map(i => i.id)).not.toContain(page1.items[0].id)
    expect(page2.items).toHaveLength(1)

    const opml = await (await fetch(`${base}/news/feeds.opml`)).text()
    expect(opml).toContain('xmlUrl="https://example.org/feed/"')
    expect((await post(base, '/news/feeds', { url: 'https://example.org/feed/' })).json).toMatchObject({ existing: true })
  })

  it('saves an item as a bookmark or a task, linked back and starred', async () => {
    const { base, store, made, links, changes } = await listen()
    await post(base, '/news/feeds', { url: 'https://example.org/feed/' })
    const item = (await store.itemList()).items.find(i => i.link)
    const saved = await post(base, `/news/item/${item.id}/bookmark`, {})
    expect(saved.json).toMatchObject({ ok: true, created: true })
    const added = changes.find(c => c.op === 'add' && c.graph === 'graph:facet/gnamgnam')
    expect(added.triples.join('\n')).toContain(`<http://purl.org/dc/terms/source> <${item.iri}>`)
    expect(links.added[0]).toMatchObject({ from: item.iri, kind: 'resource', to: saved.json.iri })

    const task = await post(base, `/news/item/${item.id}/task`, {})
    expect(task.json).toMatchObject({ ok: true, id: 'tk1' })
    expect(made[0]).toMatchObject({ title: item.title, status: 'todo', tags: ['news'] })
    expect(made[0].note).toContain(item.link)
    expect(await store.item(item.id)).toMatchObject({ starred: true, read: true })
  })

  it('imports a list and shows feed and item pages', async () => {
    const { base, store } = await listen()
    const imported = await post(base, '/news/feeds/import', { list: 'https://example.org/feed/\nhttps://other.example/rss\nnot a url' })
    expect(imported.json).toEqual({ ok: true, added: 2, found: 2 })
    const feed = await store.feedByUrl('https://example.org/feed/')
    expect((await post(base, `/news/feed/${feed.slug}/poll`, {})).json).toMatchObject({ status: 'ok', fresh: 3 })
    const page = await (await fetch(`${base}/news/feed/${feed.slug}`)).text()
    expect(page).toContain('Synth &amp; Wood')
    const item = (await store.itemList()).items.find(i => i.title === 'Building a VCO')
    const itemPage = await fetch(`${base}/news/item/${item.id}`)
    expect(itemPage.status).toBe(200)
    expect((await fetch(`${base}/find.json?q=vco`).then(r => r.json())).groups.find(g => g.facet === 'news').results[0].href).toBe(`/news/item/${item.id}`)
    expect((await fetch(`${base}/health`).then(r => r.json())).facets.news).toMatchObject({ feeds: 2, items: 3 })
  })

  it('manages feeds on the admin page: two lists, and actions on what is ticked', async () => {
    const { base, store } = await listen()
    await post(base, '/news/feeds', { url: 'https://example.org/feed/' })
    await post(base, '/news/feeds/import', { list: 'https://other.example/rss\nhttps://third.example/rss' })
    const byUrl = url => store.feedList().then(list => list.find(f => f.url === url))
    const [a, b, c] = [await byUrl('https://example.org/feed/'), await byUrl('https://other.example/rss'), await byUrl('https://third.example/rss')]
    await store.recordPoll(b, { status: 'refused', lastError: 'HTTP 403', failures: 1, parked: true })

    const redirected = await fetch(`${base}/news/feeds?notice=hi`, { redirect: 'manual' })
    expect([redirected.status, redirected.headers.get('location')]).toEqual([301, '/news/admin?notice=hi'])
    const page = await (await fetch(`${base}/news/admin`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(page).toContain('Being read (2)')
    expect(page).toContain('Failing, set aside (1)')
    expect(page).toContain('HTTP 403')
    expect(page).toContain(`name="slugs" value="${b.slug}"`)
    expect(await (await fetch(`${base}/news/`)).text()).toContain('Manage feeds (3, 1 failing)')
    // Strangers see the lists, without the ticks and buttons.
    expect(await (await fetch(`${base}/news/admin`)).text()).not.toContain('name="slugs"')

    expect((await post(base, '/news/admin', { action: 'park', slugs: [c.slug] })).json.notice).toBe('Set aside: 1 feed.')
    expect(c.parked).toBe(true)
    expect((await post(base, '/news/admin', { action: 'unpark', slugs: [b.slug, c.slug] })).json.notice).toBe('Returned to reading: 2 feeds.')
    expect([b.parked, c.parked]).toEqual([false, false])
    expect((await post(base, '/news/admin', { action: 'reread', slugs: [] })).json.notice).toBe('Nothing ticked.')
    expect((await post(base, '/news/admin', { action: 'reread', slugs: a.slug })).json.notice).toBe('Rereading 1 feed in the background.')
    expect((await post(base, '/news/admin', { action: 'delete', slugs: [b.slug, c.slug] })).json.notice).toBe('Deleted 2 feeds and 0 items.')
    expect((await store.feedList()).map(f => f.slug)).toEqual([a.slug])
    expect((await post(base, '/news/admin', { action: 'explode', slugs: [a.slug] })).status).toBe(400)
  })
})
