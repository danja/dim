import { describe, it, expect, afterEach } from 'vitest'
import { hostOf, urlsIn, badLinks } from '../../src/common/links/urls.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createNewsFacet } from '../../src/news/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { createBlogFacet } from '../../src/blog/index.js'
import { createSquirtFacet } from '../../src/squirt/index.js'
import Poller from '../../src/news/Poller.js'
import { memoryNews } from '../news/memoryNews.js'
import { memoryWiki } from '../wiki/memoryWiki.js'
import { memoryPosts } from '../blog/memoryPosts.js'

const TOKEN = 'test-token-0123456789abcdef'
const B = 'http://purl.org/stuff/dim/bookmark/'
const OWNER = { Authorization: `Bearer ${TOKEN}` }

describe('URL helpers', () => {
  it('finds hosts and URLs', async () => {
    expect(hostOf('https://www.Example.org/a')).toBe('example.org')
    expect(hostOf('nope')).toBeNull()
    expect(urlsIn('See https://a.org/x, [b](https://b.org/y) and https://a.org/x again. `https://code.org`')).toEqual(['https://a.org/x', 'https://b.org/y'])
    const registry = { async urlStatus (u) { return u.includes('dead') ? { status: 'dead', href: '/b', label: 'L' } : { status: 'ok' } } }
    expect(await badLinks('https://ok.org https://x.org/dead', registry)).toEqual([{ url: 'https://x.org/dead', status: 'dead', href: '/b', label: 'L' }])
  })
})

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

async function listen () {
  const doc = (slug, url, extra = {}) => ({ iri: B + slug, url, name: `Bookmark ${slug}`, domain: hostOf(url), linkStatus: 'ok', userTags: [], ...extra })
  const docs = [
    doc('a', 'https://synth.example/posts/1'),
    doc('b', 'https://synth.example/posts/2'),
    doc('gone', 'https://old.example/page', { linkStatus: 'dead', archivedAt: 'https://web.archive.org/web/2020/https://old.example/page' }),
    doc('lonely', 'https://nofeed.example/x', { source: 'http://purl.org/stuff/dim/page/origin' })
  ]
  const search = { documents: new Map(docs.map(d => [d.iri, d])), index: { size: 0 }, async facets () { return {} } }
  const { store: news } = await memoryNews()
  const feed = await news.addFeed({ url: 'https://synth.example/feed.xml', title: 'Synth blog', siteUrl: 'https://synth.example/' }, 'o')
  await news.addItems(feed, [
    { guid: '1', link: 'https://synth.example/posts/1', title: 'Post one', published: '2026-09-26T00:00:00.000Z', summary: 's', categories: [] },
    { guid: '3', link: 'https://synth.example/posts/3', title: 'Post three', published: '2026-09-25T00:00:00.000Z', summary: 's', categories: [] }
  ])
  const poller = new Poller({ store: news })
  const { store: wiki } = memoryWiki()
  await wiki.save({ title: 'Origin', content: 'Links: https://old.example/page and https://synth.example/posts/2', actor: 'o' })
  const { store: posts } = memoryPosts()
  const synced = []
  const links = { async linksOf () { return [] }, async syncMentions (c) { synced.push(c) }, async add () {} }
  const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store: wiki }), createNewsFacet({ store: news, poller }), createBlogFacet({ store: posts, wiki }), createSquirtFacet({})]
  const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({ token: TOKEN }), links } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, news, synced }
}

describe('URL contact between facets', () => {
  it('news knows what is bookmarked, and feeds and bookmarks know each other', async () => {
    const { base, news } = await listen()
    const river = await (await fetch(`${base}/news/?view=all`)).text()
    expect(river.match(/class="bookmarked"/g)).toHaveLength(1)
    const [one] = (await news.itemList({ view: 'all' })).items.filter(i => i.title === 'Post one')
    const item = await (await fetch(`${base}/news/item/${one.id}`, { headers: OWNER })).text()
    expect(item).toContain('Already bookmarked: <a href="/gnamgnam/bookmark/a">')
    expect(item).not.toContain('Save as bookmark')
    const feed = (await news.feedList())[0]
    expect(await (await fetch(`${base}/news/feed/${feed.slug}`)).text()).toMatch(/From this site<\/dt><dd><a href="\/gnamgnam\/\?domain=synth.example">2 bookmarks from synth.example<\/a>/)

    const bookmark = await (await fetch(`${base}/gnamgnam/bookmark/a`)).text()
    expect(bookmark).toContain(`From this site: <a href="/news/feed/${feed.slug}">Synth blog</a>`)
    const lonely = await (await fetch(`${base}/gnamgnam/bookmark/lonely`, { headers: OWNER })).text()
    expect(lonely).toContain('value="https://nofeed.example/"')
    expect(lonely).toContain("Look for this site's feed")
    expect(lonely).toContain('Saved from <a href="/wiki/page/origin">Origin</a>')
  })

  it('warns about dead links in wiki pages and says when a shared URL is bookmarked', async () => {
    const { base } = await listen()
    const page = await (await fetch(`${base}/wiki/page/origin`, { headers: OWNER })).text()
    expect(page).toContain('Links to check')
    expect(page).toContain('https://old.example/page</a> <small class="meta">gone')
    expect(page).toContain('archived copy')
    expect(page).not.toContain('synth.example/posts/2</a> <small')
    expect(await (await fetch(`${base}/wiki/page/origin`)).text()).not.toContain('Links to check')
    const share = await (await fetch(`${base}/squirt/share?url=${encodeURIComponent('https://synth.example/posts/2')}`, { headers: OWNER })).text()
    expect(share).toContain('Already bookmarked: <a href="/gnamgnam/bookmark/b">')
  })

  it('records a blog post’s mentions', async () => {
    const { base, synced } = await listen()
    const auth = { ...OWNER, 'Content-Type': 'application/json', Accept: 'application/json' }
    const { slug } = await (await fetch(`${base}/blog/posts`, { method: 'POST', headers: auth, body: JSON.stringify({ title: 'Notes', content: 'See [[Origin]] and [[bookmark/a]].' }) })).json()
    expect(synced.at(-1)).toEqual({ from: `http://purl.org/stuff/dim/post/${slug}`, targets: [`${B}a`, 'http://purl.org/stuff/dim/page/origin'], actor: 'owner' })
    await fetch(`${base}/blog/post/${slug}`, { method: 'POST', headers: auth, body: JSON.stringify({ content: 'Only [[bookmark/b]] now.' }) })
    expect(synced.at(-1).targets).toEqual([`${B}b`])
  })
})
