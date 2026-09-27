import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import TopicStore from '../../src/common/topics/TopicStore.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

const P = 'http://purl.org/stuff/dim/'
const T = slug => `${P}concept/topic-${slug}`

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('topic hubs', () => {
  it('list the scheme, gather each topic across facets, and meet tags', async () => {
    const { store: wiki } = memoryWiki()
    const page = await wiki.save({ title: 'Eurorack notes', content: 'x', tags: 'eurorack', actor: 'o' })
    const client = {
      async select (q) {
        if (q.includes('skos:prefLabel ?label')) {
          return [
            { topic: T('modular-synthesizer'), label: 'modular synthesizers', alts: 'modular synthesizer' },
            { topic: T('eurorack'), label: 'eurorack', broader: T('modular-synthesizer') }
          ]
        }
        return [{ s: `${P}bookmark/vco`, topic: T('eurorack') }, { s: page.iri, topic: T('eurorack') }, { s: `${P}bookmark/vco`, topic: T('modular-synthesizer') }]
      }
    }
    const topics = new TopicStore({ client })
    const docs = new Map([[`${P}bookmark/vco`, { iri: `${P}bookmark/vco`, name: 'VCO kit', url: 'https://e.org', linkStatus: 'ok', userTags: [], topics: ['eurorack'] }]])
    const facets = [createGnamgnamFacet({ search: { documents: docs, index: { size: 0 }, async facets () { return {} } } }), createWikiFacet({ store: wiki })]
    const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({}), topics } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`

    const tree = await (await fetch(`${base}/topics`)).text()
    expect(tree).toMatch(/modular synthesizers<\/a> <small class="meta">1<\/small><ul><li><a href="\/topics\/eurorack">eurorack<\/a>/)
    const hub = await (await fetch(`${base}/topics/eurorack`)).text()
    expect(hub).toContain('<a href="/topics/modular-synthesizer">modular synthesizers</a></nav>')
    expect(hub).toMatch(/GnamGnam <small class="meta">1<\/small>[\s\S]*VCO kit/)
    expect(hub).toMatch(/Wiki <small class="meta">1<\/small>[\s\S]*Eurorack notes/)
    expect(hub).toContain('href="/tags/eurorack"')
    expect(await (await fetch(`${base}/tags/eurorack`)).text()).toContain('Also a topic: <a href="/topics/eurorack">eurorack</a>')
    expect(await (await fetch(`${base}/wiki/page/eurorack-notes`)).text()).toContain('Topics: <a href="/topics/eurorack">eurorack</a>')
    expect((await fetch(`${base}/topics/nope`)).status).toBe(404)
    expect((await topics.forTag('Modular-Synthesizers'))?.slug).toBe('modular-synthesizer')
  })
})
