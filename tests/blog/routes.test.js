import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createBlogFacet } from '../../src/blog/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'
import { memoryPosts } from './memoryPosts.js'

const TOKEN = 'test-token-0123456789abcdef'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }

let servers = []
async function listen () {
  const { store } = memoryPosts()
  const { store: wiki } = memoryWiki()
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store: wiki }), createBlogFacet({ store, wiki, title: 'Test blog', author: 'Me' })]
  const server = createServer({ facets, defaultFacet: 'blog', services: { auth: new Auth({ token: TOKEN }) } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, store, wiki }
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: AUTH, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() }))

describe('blog routes', () => {
  it('keeps drafts from everyone but the owner', async () => {
    const { base } = await listen()
    const { json } = await post(base, '/blog/posts', { title: 'Hidden thoughts', content: 'Draft text' })
    expect(json).toMatchObject({ ok: true, slug: 'hidden-thoughts' })
    expect((await fetch(`${base}/blog/post/hidden-thoughts`)).status).toBe(404)
    expect((await fetch(`${base}/blog/post/hidden-thoughts.md`)).status).toBe(404)
    expect(await (await fetch(`${base}/blog/`)).text()).not.toContain('Hidden thoughts')
    expect(await (await fetch(`${base}/blog/feed.atom`)).text()).not.toContain('Hidden')
    expect(JSON.stringify(await (await fetch(`${base}/find.json?q=hidden`)).json())).not.toContain('Hidden')
    const owner = await fetch(`${base}/blog/post/hidden-thoughts`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(owner.status).toBe(200)
    expect(await owner.text()).toContain('not published')
  })

  it('publishes at a dated URL, with the feed, and redirects the short path', async () => {
    const { base } = await listen()
    await post(base, '/blog/posts', { title: 'Hello world', content: 'First!' })
    await post(base, '/blog/post/hello-world', { content: 'First, **edited**.', tags: 'Intro' })
    const published = await post(base, '/blog/post/hello-world/publish', { publish: true })
    expect(published.json).toEqual({ ok: true, status: 'published', href: '/blog/2026/09/26/hello-world' })
    const page = await fetch(`${base}/blog/2026/09/26/hello-world`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('<strong>edited</strong>')
    const short = await fetch(`${base}/blog/post/hello-world`, { redirect: 'manual' })
    expect(short.headers.get('location')).toBe('/blog/2026/09/26/hello-world')
    expect((await fetch(`${base}/blog/2020/01/01/hello-world`, { redirect: 'manual' })).status).toBe(301)
    const feed = await (await fetch(`${base}/blog/feed.atom`)).text()
    expect(feed).toContain('<title>Test blog</title>')
    expect(feed).toContain(`<id>${base}/blog/2026/09/26/hello-world</id>`)
    expect(await (await fetch(`${base}/blog/tag/intro`)).text()).toContain('Hello world')
  })

  it('starts a draft from a wiki page', async () => {
    const { base, wiki } = await listen()
    const page = await wiki.save({ title: 'Dice notes', content: 'Two dice, [[Other]].', tags: 'dice', actor: 'owner' })
    const { json } = await post(base, '/blog/posts', { from: page.iri })
    const draft = await (await fetch(`${base}/blog/post/${json.slug}.json`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json()
    expect(draft).toMatchObject({ title: 'Dice notes', content: 'Two dice, [[Other]].', tags: ['dice'], derivedFrom: page.iri, status: 'draft' })
    expect((await post(base, '/blog/posts', { from: '/wiki/page/dice-notes' })).json.slug).toBe('dice-notes-2')
    expect((await post(base, '/blog/posts', { from: 'https://example.org/' })).status).toBe(422)
  })
})
