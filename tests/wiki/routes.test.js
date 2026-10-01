import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from './memoryWiki.js'

const TOKEN = 'test-token-0123456789abcdef'
const JSON_AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }

let servers = []
async function listen () {
  const { store } = memoryWiki()
  const synced = []
  const hashtags = []
  const links = { async syncMentions (change) { synced.push(change) }, async syncHashtags (change) { hashtags.push(change) }, async linksOf () { return [] } }
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store })]
  const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({ token: TOKEN }), links } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, store, synced, hashtags }
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

const save = (base, slug, body) => fetch(`${base}/wiki/page/${slug}`, { method: 'POST', headers: JSON_AUTH, body: JSON.stringify(body) })

describe('wiki routes', () => {
  it('syncs the #hashtags in a page\'s text when it is saved', async () => {
    const { base, hashtags } = await listen()
    await save(base, 'home', { title: 'Home', content: 'Notes on #Synth/diy and `#code`, issue #12', base: 0 })
    expect(hashtags.at(-1)).toMatchObject({ from: 'http://purl.org/stuff/dim/page/home', tags: ['synth/diy'] })
  })

  it('offers to create a missing page, then shows it once saved', async () => {
    const { base, synced } = await listen()
    const missing = await fetch(`${base}/wiki/page/new-idea?title=New%20Idea`)
    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('There is no page with this name yet')

    expect(await (await save(base, 'home', { title: 'Home', content: 'Go to [[New Idea]]', base: 0 })).json()).toMatchObject({ ok: true, revision: 1 })
    const home = await (await fetch(`${base}/wiki/page/home`)).text()
    expect(home).toContain('href="/wiki/page/new-idea?title=New%20Idea"')
    expect(synced.at(-1)).toMatchObject({ from: 'http://purl.org/stuff/dim/page/home', targets: [] })

    // Creating the page it was waiting for links the earlier mention.
    await save(base, 'new-idea', { title: 'New Idea', content: 'Here.', base: 0 })
    expect(synced.at(-1)).toMatchObject({ from: 'http://purl.org/stuff/dim/page/home', targets: ['http://purl.org/stuff/dim/page/new-idea'] })
    expect(await (await fetch(`${base}/wiki/page/home`)).text()).toContain('href="/wiki/page/new-idea"')
    expect(await (await fetch(`${base}/wiki/page/home.md`)).text()).toBe('Go to [[New Idea]]')

    const found = await (await fetch(`${base}/find.json?q=idea`)).json()
    expect(JSON.stringify(found)).toContain('/wiki/page/new-idea')
  })

  it('previews without saving and refuses a stale edit with 409', async () => {
    const { base, store } = await listen()
    await save(base, 'home', { title: 'Home', content: 'one', base: 0 })
    const preview = await (await save(base, 'home', { title: 'Home', content: '**two**', base: 1, action: 'preview' })).json()
    expect(preview.html).toContain('<strong>two</strong>')
    expect((await store.get('home')).revision).toBe(1)

    expect((await save(base, 'home', { title: 'Home', content: 'two', base: 1 })).status).toBe(200)
    const stale = await save(base, 'home', { title: 'Home', content: 'three', base: 1 })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ revision: 2 })

    // The form version keeps the text and rebases the form on revision 2.
    const form = await fetch(`${base}/wiki/page/home`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'title=Home&content=three&base=1' })
    expect(form.status).toBe(409)
    const html = await form.text()
    expect(html).toContain('Edit conflict')
    expect(html).toContain('name="base" value="2"')
    expect(html).toMatch(/<textarea[^>]*>three<\/textarea>/)
  })

  it('needs a login to edit', async () => {
    const { base } = await listen()
    const edit = await fetch(`${base}/wiki/page/home/edit`, { redirect: 'manual' })
    expect(edit.status).toBe(303)
    expect(edit.headers.get('location')).toBe('/login?return=%2Fwiki%2Fpage%2Fhome%2Fedit')
    expect((await fetch(`${base}/wiki/page/home`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' })).status).toBe(401)
  })
})
