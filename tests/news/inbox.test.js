import { describe, it, expect, afterEach } from 'vitest'
import { feedsOnPage } from '../../src/news/feedsOnPage.js'
import FeedInbox from '../../src/news/FeedInbox.js'
import { scanBookmarks, scanPlan } from '../../src/news/scanBookmarks.js'
import { Enricher } from '../../src/gnamgnam/enrich/Enricher.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createNewsFacet } from '../../src/news/index.js'
import Poller from '../../src/news/Poller.js'
import { NEWS_CONFIG } from '../../config/preferences.js'
import { memoryNews, fakeFetch } from './memoryNews.js'

const B = 'http://purl.org/stuff/dim/bookmark/'
const page = links => `<!doctype html><html><head><title>A blog</title>${links}</head><body><p>Hello</p></body></html>`
const alt = (href, title = null, type = 'application/rss+xml') => `<link rel="alternate" type="${type}" href="${href}"${title ? ` title="${title}"` : ''}>`

describe('feeds on a page', () => {
  it('keeps the page\'s own feeds, not comment feeds, and skips GitHub', () => {
    const html = page(alt('/feed/', 'Synth Blog') + alt('/comments/feed/', 'Synth Blog » Comments Feed') + alt('/atom.xml', 'Atom', 'application/atom+xml'))
    expect(feedsOnPage(html, 'https://synth.example/2026/vco')).toEqual([
      { url: 'https://synth.example/feed/', title: 'Synth Blog' },
      { url: 'https://synth.example/atom.xml', title: 'Atom' }
    ])
    expect(feedsOnPage(page(alt('/me/repo/commits/main.atom', 'Recent Commits')), 'https://github.com/me/repo')).toEqual([])
    expect(feedsOnPage('<a href="/rss.xml">RSS</a>', 'https://plain.example/')).toEqual([{ url: 'https://plain.example/rss.xml', title: null }])
    expect(feedsOnPage(page(''), 'https://none.example/')).toEqual([])
  })
})

async function inboxOver () {
  const news = await memoryNews()
  const inbox = new FeedInbox({ client: news.client, news: news.store, now: () => new Date('2026-09-28T10:00:00Z') })
  return { ...news, inbox }
}

describe('the feed inbox', () => {
  it('suggests each feed once, with every bookmark it was on, never one already read or dismissed', async () => {
    const { inbox, store, updates } = await inboxOver()
    await store.addFeed({ url: 'https://read.example/feed', title: 'Read already' }, 'test')

    const first = await inbox.addFromPage({ html: page(alt('/feed/', 'Synth Blog') + alt('https://read.example/feed')), pageUrl: 'https://synth.example/a', source: `${B}a` })
    expect(first.found).toBe(2)
    expect(first.added.map(s => s.url)).toEqual(['https://synth.example/feed/'])
    expect(updates.at(-1)).toContain('<http://purl.org/stuff/dim/FeedSuggestion>')

    const again = await inbox.addFromPage({ html: page(alt('/feed/')), pageUrl: 'https://synth.example/b', source: `${B}b` })
    expect(again.added).toEqual([])
    const [s] = await inbox.list()
    expect(s).toMatchObject({ title: 'Synth Blog', foundOn: 'https://synth.example/a', sources: [`${B}a`, `${B}b`], status: 'new' })
    expect([...await inbox.knownHosts()].sort()).toEqual(['read.example', 'synth.example'])

    await inbox.dismiss([s])
    expect(await inbox.list()).toEqual([])
    expect((await inbox.addFromPage({ html: page(alt('/feed/')), pageUrl: 'https://synth.example/c' })).added).toEqual([])
    expect(await inbox.list({ status: 'dismissed' })).toHaveLength(1)
  })

  it('is shown every page the enricher fetches', async () => {
    const seen = []
    const enricher = new Enricher({
      fetchers: [{ canHandle: () => true, fetch: async url => ({ url, body: page(alt('/feed/')), contentType: 'text/html', httpStatus: 200 }) }],
      extractors: [{ canHandle: () => true, extract: async () => ({ text: 'Hello there, a page about synths.', title: 'A blog' }) }],
      summarisers: [{ id: 'fake', summarise: async () => ({ summary: 'Synths.', model: 'fake' }) }],
      observers: [{ observe: async o => seen.push(o) }, { observe: async () => { throw new Error('boom') } }]
    })
    expect((await enricher.run({ iri: `${B}a`, graph: 'graph:facet/gnamgnam', url: 'https://synth.example/a' })).status).toBe('enriched')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ bookmarkIri: `${B}a`, url: 'https://synth.example/a', fetched: { contentType: 'text/html' } })

    const { inbox } = await inboxOver()
    await inbox.observer().observe(seen[0])
    await inbox.observer().observe({ ...seen[0], fetched: { ...seen[0].fetched, contentType: 'application/pdf' } })
    expect((await inbox.list()).map(s => s.url)).toEqual(['https://synth.example/feed/'])
  })
})

describe('scanning bookmarks for feeds', () => {
  const docs = [
    ...[1, 2, 3, 4].map(n => ({ iri: `${B}s${n}`, url: `https://synth.example/${n}`, contentType: 'text/html', linkStatus: 'ok' })),
    { iri: `${B}r1`, url: 'https://read.example/x', contentType: 'text/html', linkStatus: 'ok' },
    { iri: `${B}pdf`, url: 'https://papers.example/a.pdf', contentType: 'application/pdf', linkStatus: 'ok' },
    { iri: `${B}dead`, url: 'https://gone.example/', contentType: null, linkStatus: 'dead' },
    { iri: `${B}gh`, url: 'https://github.com/me/repo', contentType: 'text/html', linkStatus: 'ok' },
    { iri: `${B}q1`, url: 'https://quiet.example/1', contentType: null, linkStatus: 'unchecked' }
  ]
  const config = { ...NEWS_CONFIG, perHostIntervalMs: 0, scanPagesPerHost: 3 }

  it('plans a few pages per site, skipping known sites, non-pages and dead links', () => {
    const plan = scanPlan(docs, { state: new Map(), knownHosts: new Set(['read.example']), config })
    expect(plan.map(p => [p.host, p.docs.length])).toEqual([['synth.example', 3], ['quiet.example', 1]])
    const later = scanPlan(docs, { state: new Map([[`${B}s1`, { found: 0 }], [`${B}s2`, { found: 0 }]]), knownHosts: new Set(), config })
    expect(later.find(p => p.host === 'synth.example').docs.map(d => d.iri)).toEqual([`${B}s3`]) // one page left for this site
  })

  it('stops at a site\'s first page with a feed, remembers what it saw, and carries on later', async () => {
    const { inbox, store } = await inboxOver()
    await store.addFeed({ url: 'https://read.example/feed', title: 'Read', siteUrl: 'https://read.example/' }, 'test')
    const { impl, calls } = fakeFetch({
      'https://synth.example/1': { body: page(''), headers: { 'content-type': 'text/html' } },
      'https://synth.example/2': { body: page(alt('/feed/', 'Synth Blog')), headers: { 'content-type': 'text/html; charset=utf-8' } },
      'https://quiet.example/1': { status: 404 }
    })
    const state = new Map()
    const totals = await scanBookmarks({ docs, inbox, state, fetchImpl: impl, config, sleep: async () => {} })
    expect(totals).toEqual({ pages: 3, withFeeds: 1, added: 1, errors: 0 })
    expect(calls.map(c => c.url).sort()).toEqual(['https://quiet.example/1', 'https://synth.example/1', 'https://synth.example/2'])
    expect(state.get(`${B}s2`)).toMatchObject({ found: 1 })
    expect((await inbox.list())[0]).toMatchObject({ url: 'https://synth.example/feed/', sources: [`${B}s2`] })

    calls.length = 0
    expect(await scanBookmarks({ docs, inbox, state, fetchImpl: impl, config, sleep: async () => {} })).toMatchObject({ pages: 0 })
    expect(calls).toEqual([])
  })
})

const TOKEN = 'test-token-0123456789abcdef'
let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('the inbox on Manage feeds', () => {
  it('lists suggestions, subscribes to ticked ones (and reads them), and dismisses others', async () => {
    const { inbox, store } = await inboxOver()
    const { impl } = fakeFetch({})
    const poller = new Poller({ store, config: { ...NEWS_CONFIG, perHostIntervalMs: 0 }, fetchImpl: impl, sleep: async () => {} })
    const server = createServer({ facets: [createNewsFacet({ store, poller, inbox })], defaultFacet: 'news', services: { auth: new Auth({ token: TOKEN }), repository: store.repository } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`
    await inbox.addFromPage({ html: page(alt('/feed/', 'Synth Blog')), pageUrl: 'https://synth.example/a' })
    await inbox.addFromPage({ html: page(alt('/rss')), pageUrl: 'https://wood.example/b' })
    const [synth, wood] = [...await inbox.list()].sort((x, y) => x.url.localeCompare(y.url))

    const html = await (await fetch(`${base}/news/admin`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(html).toContain('Found on your bookmarks (2)')
    expect(html).toContain(`name="suggestions" value="${synth.id}"`)
    expect(await (await fetch(`${base}/news/`)).text()).toContain('Manage feeds (0, 2 found)')

    const post = body => fetch(`${base}/news/admin`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
    expect((await post({ action: 'subscribe', suggestions: [synth.id] })).notice).toBe('Subscribed to 1 feed; reading them in the background.')
    expect((await store.feedList()).map(f => [f.url, f.title, f.siteUrl])).toEqual([['https://synth.example/feed/', 'Synth Blog', 'https://synth.example/']])
    expect((await post({ action: 'dismiss', suggestions: wood.id })).notice).toBe('Dismissed 1 suggestion.')
    expect(await inbox.list()).toEqual([])
    await poller.running
  })
})
