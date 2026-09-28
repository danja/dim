import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createHash } from 'crypto'
import VectorIndex from '../../src/common/vectors/VectorIndex.js'
import RelatedIndex from '../../src/common/related/RelatedIndex.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

const DIM = 64
const MODEL = 'test-words'
const P = 'http://purl.org/stuff/dim/'

/** Words hashed into positions: texts sharing words are similar. */
function wordEmbeddings ({ failing = false } = {}) {
  return {
    async embed (text) {
      if (failing) throw new Error('ollama down')
      const v = new Array(DIM).fill(0)
      for (const w of String(text).toLowerCase().match(/[a-z]{3,}/g) ?? []) v[createHash('md5').update(w).digest()[0] % DIM] += 1
      if (v.every(x => x === 0)) v[0] = 1
      return v
    }
  }
}

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

async function setup ({ failing = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dim-search-'))
  const { store: wiki } = memoryWiki()
  await wiki.save({ title: 'Oscillators', content: 'eurorack oscillator module notes', actor: 'o' })
  await wiki.save({ title: 'Bread', content: 'sourdough starter', actor: 'o' })
  const vco = { iri: `${P}bookmark/vco`, name: 'VCO schematic', url: 'https://e.org/vco', summary: 'A through-hole build.', linkStatus: 'ok', userTags: [] }
  const words = wordEmbeddings()
  const bookmarks = await VectorIndex.open({ dimension: DIM, path: path.join(dir, 'b.index'), model: MODEL })
  bookmarks.add(vco.iri, await words.embed('VCO schematic eurorack oscillator module'))
  const index = await VectorIndex.open({ dimension: DIM, path: path.join(dir, 'related.index'), model: MODEL })
  const related = await new RelatedIndex({ index, bookmarks, embeddings: failing ? wordEmbeddings({ failing }) : words, statePath: path.join(dir, 'state.json'), minScore: 0.3 }).load()
  // Bookmark search by words: only "schematic" finds it.
  const search = { documents: new Map([[vco.iri, vco]]), index: { size: 1 }, async facets () { return {} }, async search (q) { return { results: /schematic/i.test(q) ? [vco] : [] } } }
  const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store: wiki })]
  if (!failing) await related.sync(facets)
  const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({}), related } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  const base = `http://localhost:${server.address().port}`
  return { base, find: async (query) => (await fetch(`${base}/find.json?ranked=1&${query}`)).json() }
}

describe('search everything', () => {
  it('ranks by meaning and words together, across facets', async () => {
    const { base, find } = await setup()
    const found = await find('q=eurorack+oscillator')
    expect(found.results.map(r => [r.label, r.facet, r.by])).toEqual([
      ['Oscillators', 'wiki', 'both'], // the wiki finds its words too
      ['VCO schematic', 'gnamgnam', 'meaning']
    ])
    expect(found.results[1]).toMatchObject({ href: '/gnamgnam/bookmark/vco' })
    expect(found.facets.map(f => [f.facet, f.count])).toEqual([['wiki', 1], ['gnamgnam', 1]])
    expect((await find('q=eurorack+oscillator&facet=gnamgnam')).results.map(r => r.label)).toEqual(['VCO schematic'])
    expect((await find('q=sourdough')).results.map(r => r.label)).toEqual(['Bread'])

    const page = await (await fetch(`${base}/find?q=eurorack+oscillator`)).text()
    expect(page).toContain('<a href="/gnamgnam/bookmark/vco">VCO schematic</a>')
    expect(page).toContain('GnamGnam · similar meaning')
    expect(page).toMatch(/<a href="\/find\?q=eurorack%20oscillator&amp;facet=wiki">Wiki <span class="count">1<\/span><\/a>/)
    // The link picker's words-only groups are unchanged.
    expect((await (await fetch(`${base}/find.json?q=schematic`)).json()).groups[0].results[0].label).toBe('VCO schematic')
  })

  it('falls back to words when embeddings are down, and says so', async () => {
    const { base, find } = await setup({ failing: true })
    const found = await find('q=sourdough')
    expect(found.results.map(r => [r.label, r.by])).toEqual([['Bread', 'words']])
    expect(found.semanticError).toMatch(/Ollama/)
    expect(await (await fetch(`${base}/find?q=sourdough`)).text()).toContain('Searching by words only')
  })
})
