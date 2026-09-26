import { describe, it, expect } from 'vitest'
import { XMLValidator } from 'fast-xml-parser'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import { postTriples } from '../../src/blog/rdf.js'
import { datedPath, appPath, postHtml, excerpt, atomFeed } from '../../src/blog/render.js'
import { buildSite } from '../../src/blog/staticSite.js'
import { parseFeed } from '../../src/news/formats/feed.js'
import { memoryPosts } from './memoryPosts.js'

const DAY = 86400000

async function sample () {
  const { store, advance, writes } = memoryPosts()
  const first = await store.create({ title: 'Getting Things Diced', content: 'Roll **two** dice.\n\nSee [[Second Post]], [[Wiki Only]], [[bookmark/abc]] and [the wiki](/wiki/page/x).', tags: 'GTD, Dice' }, 'owner')
  await store.setPublished(first, true, 'owner')
  advance(3 * DAY)
  const second = await store.create({ title: 'Second Post', content: 'Back to [the first](/blog/post/getting-things-diced).' }, 'owner')
  await store.setPublished(second, true, 'owner')
  const draft = await store.create({ title: 'Secret draft', content: 'Not yet.' }, 'owner')
  return { store, advance, writes, first: await store.get('getting-things-diced'), second: await store.get('second-post'), draft }
}

describe('posts', () => {
  it('get unique slugs, a date on first publishing that never moves, and valid triples', async () => {
    const { store, advance, first, draft } = await sample()
    expect((await store.create({ title: 'Getting Things Diced' }, 'owner')).slug).toBe('getting-things-diced-2')
    expect(first.issued).toBe('2026-09-26T10:00:00.000Z')
    expect(appPath(first)).toBe('/blog/2026/09/26/getting-things-diced')
    expect(appPath(draft)).toBe('/blog/post/secret-draft')
    advance(10 * DAY)
    const again = await store.setPublished(await store.setPublished(first, false, 'owner'), true, 'owner')
    expect(again.issued).toBe(first.issued)
    expect((await store.list()).map(p => p.slug)).toEqual(['second-post', 'getting-things-diced'])
    expect((await store.list({ drafts: true })).length).toBe(4)
    expect((await store.list({ tag: 'dice' })).map(p => p.slug)).toEqual(['getting-things-diced'])

    const validator = await ShapeValidator.load()
    expect((await validator.validateTriples(postTriples({ ...first, derivedFrom: 'http://purl.org/stuff/dim/page/x' }))).conforms).toBe(true)
    expect((await validator.validateTriples(postTriples({ ...first, status: 'maybe' }))).conforms).toBe(false)
  })

  it('link only to published posts when public; to the wiki in the app', async () => {
    const { store, first } = await sample()
    const posts = await store.list({ drafts: true })
    const pub = postHtml(first.content, { posts, postHref: p => `../../${p.slug}/`, publicOnly: true })
    expect(pub).toContain('<a href="../../second-post/">Second Post</a>')
    expect(postHtml('[[Second Post]]', { posts, postHref: p => `/x/${p.slug}/`, publicOnly: true })).toContain('<a href="/x/second-post/">')
    expect(pub).toContain('Wiki Only')
    expect(pub).not.toContain('/wiki/')
    expect(pub).not.toContain('/r/bookmark')
    expect(pub).toContain('the wiki')
    const app = postHtml(first.content, { posts, postHref: appPath })
    expect(app).toContain('href="/wiki/new?title=Wiki%20Only"')
    expect(app).toContain('href="/r/bookmark/abc"')
    expect(excerpt(first)).toBe('Roll two dice.')
  })
})

describe('Atom and the static site', () => {
  it('writes a well-formed feed of published posts only', async () => {
    const { store } = await sample()
    const xml = atomFeed(await store.list({ drafts: true }), { title: 'B & co', author: 'Danny', feedUrl: 'https://e.org/blog/feed.atom', siteUrl: 'https://e.org/blog/', absolute: p => `https://e.org/blog/${datedPath(p)}/` })
    expect(XMLValidator.validate(xml)).toBe(true)
    const feed = parseFeed(xml)
    expect(feed).toMatchObject({ format: 'atom', title: 'B & co', siteUrl: 'https://e.org/blog/' })
    expect(feed.items.map(i => i.title)).toEqual(['Second Post', 'Getting Things Diced'])
    expect(feed.items[1]).toMatchObject({ link: 'https://e.org/blog/2026/09/26/getting-things-diced/', guid: 'https://e.org/blog/2026/09/26/getting-things-diced/', categories: ['gtd', 'dice'] })
    expect(xml).not.toContain('Secret')
    expect(xml).toContain('href=&quot;https://e.org/blog/2026/09/29/second-post/&quot;')
  })

  it('exports relative pages, tags and the feed; no drafts', async () => {
    const { store } = await sample()
    const files = buildSite(await store.list({ drafts: true }), { title: 'Blog', baseUrl: 'https://e.org/blog' })
    expect([...files.keys()].sort()).toEqual(['2026/09/26/getting-things-diced/index.html', '2026/09/29/second-post/index.html', 'feed.atom', 'index.html', 'style.css', 'tag/dice/index.html', 'tag/gtd/index.html'])
    const post = files.get('2026/09/26/getting-things-diced/index.html')
    expect(post).toContain('href="../../../../2026/09/29/second-post/"')
    expect(post).toContain('href="../../../../style.css"')
    expect(post).toContain('rel="next"')
    expect(files.get('2026/09/29/second-post/index.html')).toContain('<a href="../../../../2026/09/26/getting-things-diced/">the first</a>')
    expect(files.get('index.html')).not.toContain('Secret')
    expect(XMLValidator.validate(files.get('feed.atom'))).toBe(true)
    expect(files.get('feed.atom')).toContain('<id>https://e.org/blog/feed.atom</id>')
  })
})
