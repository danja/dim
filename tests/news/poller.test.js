import { describe, it, expect } from 'vitest'
import fs from 'fs'
import Poller from '../../src/news/Poller.js'
import { NEWS_CONFIG } from '../../config/preferences.js'
import { memoryNews, fakeFetch } from './memoryNews.js'

const rss = fs.readFileSync(new URL('./fixtures/rss2.xml', import.meta.url), 'utf8')
const NOW = new Date('2026-09-26T12:00:00Z')
const config = { ...NEWS_CONFIG, perHostIntervalMs: 0 }

async function setup (table) {
  const { store } = await memoryNews({ now: () => NOW })
  const { impl, calls } = fakeFetch(table)
  const poller = new Poller({ store, config, fetchImpl: impl, now: () => NOW, sleep: async () => {} })
  return { store, poller, calls }
}

describe('Poller', () => {
  it('stores new items, learns the title, then polls conditionally', async () => {
    let etagSeen = null
    const { store, poller, calls } = await setup({
      'https://example.org/feed/': init => {
        etagSeen = init.headers['If-None-Match'] ?? null
        return etagSeen === '"v1"' ? { status: 304 } : { body: rss, headers: { etag: '"v1"', 'content-type': 'application/rss+xml' } }
      }
    })
    const feed = await store.addFeed({ url: 'https://example.org/feed/', title: 'https://example.org/feed/' }, 'test')
    expect(await poller.pollFeed(feed)).toEqual({ status: 'ok', fresh: 3 })
    expect(feed).toMatchObject({ title: 'Synth & Wood', siteUrl: 'https://example.org/', format: 'rss', etag: '"v1"', failures: 0, status: 'ok' })
    // Undated items count as new; the dated one (4 days old) too: within 14 days.
    expect((await store.itemList()).items).toHaveLength(3)

    expect(await poller.pollFeed(feed)).toEqual({ status: 'not-modified', fresh: 0 })
    expect(etagSeen).toBe('"v1"')
    expect(calls[1].headers['User-Agent']).toMatch(/^dim-news/)
  })

  it('starts old items as read on the first poll', async () => {
    const old = rss.replace('Tue, 22 Sep 2026', 'Tue, 01 Sep 2026')
    const { store, poller } = await setup({ 'https://e.org/f': { body: old } })
    const feed = await store.addFeed({ url: 'https://e.org/f', title: 'E' }, 'test')
    await poller.pollFeed(feed)
    const { items } = await store.itemList({ view: 'unread' })
    expect(items.map(i => i.title)).not.toContain('Building a VCO')
    expect(items).toHaveLength(2)
  })

  it('backs off after failures, stops on 410, records refusals', async () => {
    const { store, poller } = await setup({
      'https://a.org/404': { status: 404 },
      'https://a.org/gone': { status: 410 },
      'https://a.org/html': { body: '<html><body>hi</body></html>' },
      'https://a.org/busy': { status: 503, headers: { 'retry-after': '86400' } }
    })
    const add = url => store.addFeed({ url, title: url }, 'test')
    const refused = await add('https://a.org/404')
    expect(await poller.pollFeed(refused)).toMatchObject({ status: 'refused', error: 'HTTP 404' })
    await poller.pollFeed(refused)
    expect(refused.failures).toBe(2)
    expect(refused.nextPoll).toBe(new Date(NOW.getTime() + 4 * 3600000).toISOString())

    const gone = await add('https://a.org/gone')
    await poller.pollFeed(gone)
    expect(gone).toMatchObject({ status: 'gone', nextPoll: null })
    expect(poller.isDue(gone)).toBe(false)

    expect(await poller.pollFeed(await add('https://a.org/html'))).toMatchObject({ status: 'error', error: 'An HTML page, not a feed' })
    const busy = await add('https://a.org/busy')
    await poller.pollFeed(busy)
    expect(busy.nextPoll).toBe(new Date(NOW.getTime() + 86400000).toISOString())
    expect(await poller.pollFeed(await add('https://nowhere.example/feed'))).toMatchObject({ status: 'error', error: 'request failed: ENOTFOUND' })
  })

  it('polls only due feeds, one run at a time', async () => {
    const { store, poller } = await setup({ 'https://a.org/1': { body: rss }, 'https://b.org/2': { body: rss } })
    await store.addFeed({ url: 'https://a.org/1', title: 'A' }, 'test')
    await store.addFeed({ url: 'https://b.org/2', title: 'B' }, 'test')
    const first = poller.pollDue()
    expect(poller.pollDue()).toBe(first)
    expect(await first).toMatchObject({ polled: 2, ok: 2, fresh: 6 })
    expect(await poller.pollDue()).toMatchObject({ polled: 0 })
    expect(await poller.pollDue({ force: true })).toMatchObject({ polled: 2, fresh: 0 })
  })

  it('records a failure to store items, so the feed backs off', async () => {
    const { store, poller } = await setup({ 'https://e.org/f': { body: rss } })
    const feed = await store.addFeed({ url: 'https://e.org/f', title: 'E' }, 'test')
    store.addItems = async () => { throw new Error('store down') }
    expect(await poller.pollFeed(feed)).toMatchObject({ status: 'error', error: 'storing items failed: store down' })
    expect(feed.failures).toBe(1)
    expect(poller.isDue(feed)).toBe(false)
  })
})

