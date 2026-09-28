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

/** Words hashed into positions: texts sharing words are similar. */
export function wordEmbeddings ({ failing = false } = {}) {
  return {
    calls: 0,
    async embed (text) {
      this.calls++
      if (failing) throw new Error('ollama down')
      const v = new Array(DIM).fill(0)
      for (const w of String(text).toLowerCase().match(/[a-z]{3,}/g) ?? []) v[createHash('md5').update(w).digest()[0] % DIM] += 1
      if (v.every(x => x === 0)) v[0] = 1
      return v
    }
  }
}

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dim-related-'))
}

async function relatedIndex ({ embeddings = wordEmbeddings(), bookmarks = null } = {}) {
  const dir = tmp()
  const index = await VectorIndex.open({ dimension: DIM, path: path.join(dir, 'related.index'), model: MODEL })
  return new RelatedIndex({ index, bookmarks, embeddings, statePath: path.join(dir, 'state.json'), minScore: 0.3 }).load()
}

const P = 'http://purl.org/stuff/dim/'
const facet = (id, docs) => ({ id, documents: async () => docs })

describe('RelatedIndex', () => {
  it('embeds only what changed, forgets what went, and finds neighbours across indexes', async () => {
    const bookmarks = await VectorIndex.open({ dimension: DIM, path: path.join(tmp(), 'b.index'), model: MODEL })
    const words = wordEmbeddings()
    bookmarks.add(`${P}bookmark/vco`, await words.embed('eurorack oscillator vco module schematic'))
    const r = await relatedIndex({ embeddings: words, bookmarks })
    let wikiDocs = [{ iri: `${P}page/vco`, text: 'Notes on my eurorack oscillator module' }, { iri: `${P}page/bread`, text: 'Sourdough bread starter feeding' }]
    const tasks = [{ iri: `${P}task/t1`, text: 'Build the oscillator module for the eurorack case' }]
    const news = [{ iri: `${P}news-item/n1`, text: 'New eurorack oscillator released' }, { iri: `${P}news-item/n2`, text: 'Football results tonight' }]
    const facets = () => [facet('wiki', wikiDocs), facet('farelo', tasks), facet('news', news)]

    words.calls = 0
    expect(await r.sync(facets())).toEqual({ embedded: 5, removed: 0, unchanged: 0, failed: 0, stopped: false })
    expect(await r.sync(facets())).toMatchObject({ embedded: 0, unchanged: 5 })
    wikiDocs = [{ iri: `${P}page/vco`, text: 'Notes on my eurorack oscillator module, now with a filter' }]
    expect(await r.sync(facets())).toMatchObject({ embedded: 1, removed: 1, unchanged: 3 })
    expect(r.index.has(`${P}page/bread`)).toBe(false)

    const near = await r.related(`${P}task/t1`, tasks[0].text, { k: 4 })
    expect(near.map(h => h.iri)).toContain(`${P}bookmark/vco`)
    expect(near.map(h => h.iri)).toContain(`${P}page/vco`)
    expect(near.map(h => h.iri)).not.toContain(`${P}task/t1`)
    expect(near.map(h => h.iri)).not.toContain(`${P}news-item/n2`)
    expect(r.interest(`${P}news-item/n1`)).toBeGreaterThan(r.interest(`${P}news-item/n2`))

    // The state survives a reload.
    const again = await new RelatedIndex({ index: await VectorIndex.open({ dimension: DIM, path: r.index.path, model: MODEL }), embeddings: words, statePath: r.statePath }).load()
    expect(await again.sync(facets())).toMatchObject({ embedded: 0, unchanged: 4 })
  })

  it('stays quiet when embeddings are down', async () => {
    const down = wordEmbeddings({ failing: true })
    const r = await relatedIndex({ embeddings: down })
    const docs = Array.from({ length: 60 }, (_, i) => ({ iri: `${P}page/p${i}`, text: `page ${i} words` }))
    expect(await r.sync([facet('wiki', docs)])).toMatchObject({ embedded: 0, failed: 48, stopped: true }) // three batches of 16
    expect(await r.related(`${P}page/x`, 'anything')).toEqual([])
    const calls = down.calls
    expect(await r.related(`${P}page/y`, 'something else')).toEqual([])
    expect(down.calls).toBe(calls) // not retried within five minutes
  })
})

describe('RelatedIndex sync between processes', () => {
  it('embeds in batches when it can, and picks up what another process saved', async () => {
    const words = wordEmbeddings()
    const batches = []
    const batching = { embed: t => words.embed(t), embedBatch: async texts => { batches.push(texts.length); return Promise.all(texts.map(t => words.embed(t))) } }
    const docs = Array.from({ length: 20 }, (_, i) => ({ iri: `${P}page/b${i}`, text: `page ${i} about modular synths` }))
    const first = await relatedIndex({ embeddings: batching })
    let started = null
    expect(await first.sync([facet('wiki', docs)], { onStart: t => { started = t } })).toMatchObject({ embedded: 20 })
    expect(started).toEqual({ todo: 20, unchanged: 0, removed: 0 })
    expect(batches).toEqual([16, 4])
    // A second process opened the same files before the first one synced.
    const second = await new RelatedIndex({ index: await VectorIndex.open({ dimension: DIM, path: first.index.path, model: MODEL }), embeddings: words, statePath: first.statePath })
    expect(await second.sync([facet('wiki', docs)])).toMatchObject({ embedded: 0, unchanged: 20 })
  })

  it('stands aside while another live process holds the lock', async () => {
    const r = await relatedIndex()
    fs.writeFileSync(`${r.statePath}.lock`, String(process.ppid))
    expect(await r.sync([facet('wiki', [{ iri: `${P}page/l`, text: 'locked out' }])])).toMatchObject({ busy: true, embedded: 0 })
    fs.writeFileSync(`${r.statePath}.lock`, '999999999') // a dead process
    expect(await r.sync([facet('wiki', [{ iri: `${P}page/l`, text: 'locked out' }])])).toMatchObject({ embedded: 1 })
    expect(fs.existsSync(`${r.statePath}.lock`)).toBe(false)
  })
})

let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('Related on pages', () => {
  it('shows what is alike in other facets', async () => {
    const { store: wiki } = memoryWiki()
    await wiki.save({ title: 'Oscillators', content: 'eurorack oscillator module notes', actor: 'o' })
    await wiki.save({ title: 'Bread', content: 'sourdough starter', actor: 'o' })
    const docs = new Map([[`${P}bookmark/vco`, { iri: `${P}bookmark/vco`, name: 'VCO schematic', url: 'https://e.org/vco', linkStatus: 'ok', userTags: [] }]])
    const words = wordEmbeddings()
    const bookmarks = await VectorIndex.open({ dimension: DIM, path: path.join(tmp(), 'b.index'), model: MODEL })
    bookmarks.add(`${P}bookmark/vco`, await words.embed('VCO schematic eurorack oscillator module'))
    const related = await relatedIndex({ embeddings: words, bookmarks })
    const facets = [createGnamgnamFacet({ search: { documents: docs, index: { size: 1 }, async facets () { return {} } } }), createWikiFacet({ store: wiki })]
    await related.sync(facets)
    const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({}), related } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const html = await (await fetch(`http://localhost:${server.address().port}/wiki/page/oscillators`)).text()
    expect(html).toMatch(/<h2 id="related-h">Related<\/h2><ul><li><a href="\/gnamgnam\/bookmark\/vco">VCO schematic<\/a>/)
    expect(html).not.toContain('>Bread<')
  })
})
