import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../../src/server.js'
import Auth from '../../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../../src/wiki/index.js'
import { createBlogFacet } from '../../../src/blog/index.js'
import { createFareloFacet } from '../../../src/farelo/index.js'
import { countTags } from '../../../src/common/facets/tags.js'
import { memoryWiki } from '../../wiki/memoryWiki.js'
import { memoryPosts } from '../../blog/memoryPosts.js'

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('tags across facets', () => {
  it('counts, lists and groups everything with a tag — published posts only', async () => {
    expect(countTags([['a', 'b'], ['a'], null])).toEqual(new Map([['a', 2], ['b', 1]]))
    const { store: wiki } = memoryWiki()
    await wiki.save({ title: 'Dice notes', content: 'x', tags: 'dice, gtd', actor: 'o' })
    const { store: posts } = memoryPosts()
    const published = await posts.create({ title: 'Diced', content: 'y', tags: 'dice' }, 'o')
    await posts.setPublished(published, true, 'o')
    await posts.create({ title: 'Secret dice draft', content: 'z', tags: 'dice' }, 'o')
    const tasks = [{ id: 't1', iri: 'http://purl.org/stuff/dim/task/t1', title: 'Roll daily', status: 'todo', tags: ['dice'], dependsOn: [] }]
    const taskStore = { async list () { return tasks }, async get () { return tasks[0] }, async history () { return [] } }
    const docs = new Map([['http://purl.org/stuff/dim/bookmark/b1', { iri: 'http://purl.org/stuff/dim/bookmark/b1', name: 'Dice odds', userTags: ['dice'], summary: 's' }]])
    const search = { documents: docs, index: { size: 0 }, async facets () { return {} } }
    const facets = [createGnamgnamFacet({ search }), createFareloFacet({ store: taskStore }), createWikiFacet({ store: wiki }), createBlogFacet({ store: posts })]
    const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({}) } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`

    const { tags } = await (await fetch(`${base}/tags.json`)).json()
    expect(tags[0]).toEqual({ tag: 'dice', count: 4, facets: ['GnamGnam', 'Farelo', 'Wiki', 'Blog'] })
    expect(tags.find(t => t.tag === 'gtd')).toEqual({ tag: 'gtd', count: 1, facets: ['Wiki'] })

    const { groups } = await (await fetch(`${base}/tags/DICE.json`)).json()
    expect(groups.map(g => [g.label, g.results.map(r => r.label)])).toEqual([['GnamGnam', ['Dice odds']], ['Farelo', ['Roll daily']], ['Wiki', ['Dice notes']], ['Blog', ['Diced']]])
    const html = await (await fetch(`${base}/tags/dice`)).text()
    expect(html).toContain('Tagged “dice”')
    expect(html).not.toContain('Secret')
    expect(await (await fetch(`${base}/tags`)).text()).toContain('href="/tags/dice"')
  })
})
