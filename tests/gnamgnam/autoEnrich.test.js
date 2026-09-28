import { describe, it, expect } from 'vitest'
import AutoEnricher from '../../src/gnamgnam/AutoEnricher.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { renderBookmarkPage } from '../../src/gnamgnam/api/bookmarkPage.js'

const P = 'http://purl.org/stuff/dim/bookmark/'

/** A store of bookmark rows the fake enricher patches, and a search over it. */
function setup ({ enricher = null, createFails = false, embedFails = false } = {}) {
  const rows = new Map([
    [`${P}new`, { iri: `${P}new`, graph: 'graph:facet/gnamgnam', url: 'https://example.org/vco', name: 'https://example.org/vco', linkText: null, summary: null, fetchStatus: null, bookmarkTypes: [], tags: ['squirt'], keywords: [], catalogue: {} }],
    [`${P}done`, { iri: `${P}done`, graph: 'graph:facet/gnamgnam', url: 'https://example.org/old', name: 'Old', summary: 'Known.', fetchStatus: 200, bookmarkTypes: [], tags: [], keywords: [], catalogue: {} }]
  ])
  const search = {
    documents: new Map(),
    index: null,
    async loadDocument (iri) {
      const row = rows.get(iri)
      if (row) this.documents.set(iri, { ...row })
      return row ? { ...row } : null
    }
  }
  const runs = []
  const fakeEnricher = enricher ?? {
    async run (bookmark) {
      runs.push(bookmark)
      await new Promise(resolve => setTimeout(resolve, 10)) // a fetch takes a while
      Object.assign(rows.get(bookmark.iri), { summary: 'A voltage-controlled oscillator build.', fetchStatus: 200, keywords: ['vco', 'synth'] })
      return { status: 'enriched' }
    }
  }
  const vectors = new Map()
  const index = {
    saves: 0,
    has: iri => vectors.has(iri),
    add: (iri, v) => vectors.set(iri, v),
    compact () {},
    async save () { this.saves++ }
  }
  index.add(`${P}done`, [1])
  search.index = index
  const texts = []
  const embeddings = { async embed (text) { if (embedFails) throw new Error('ollama down'); texts.push(text); return [0.1, 0.2] } }
  const auto = new AutoEnricher({ createEnricher: () => { if (createFails) throw new Error('remote needs LLM_BASE_URL'); return fakeEnricher }, search, embeddings, index, saveDelayMs: 60000 })
  return { rows, search, runs, index, vectors, texts, auto }
}

describe('AutoEnricher', () => {
  it('fetches, summarises and embeds a bookmark saved elsewhere, once, in the background', async () => {
    const { search, runs, index, vectors, texts, auto } = setup()
    const facet = createGnamgnamFacet({ search, autoEnrich: auto })
    await facet.refresh(`${P}new`)
    expect(auto.status(`${P}new`)).toBeTruthy()
    expect(renderBookmarkPage(search.documents.get(`${P}new`), { tabs: [], enriching: auto.status(`${P}new`) })).toContain('Fetching and summarising')
    await auto.idle()

    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ url: 'https://example.org/vco', graph: 'graph:facet/gnamgnam', hasEnrichment: false })
    expect(search.documents.get(`${P}new`).summary).toBe('A voltage-controlled oscillator build.') // reloaded
    expect(vectors.has(`${P}new`)).toBe(true)
    expect(texts[0]).toContain('A voltage-controlled oscillator build.') // embedded after summarising
    expect(auto.status(`${P}new`)).toBeNull()

    await auto.flush()
    expect(index.saves).toBe(1)
    await auto.flush()
    expect(index.saves).toBe(1) // nothing new: the file is left alone

    // Already enriched and embedded: nothing to do.
    await facet.refresh(`${P}new`)
    await facet.refresh(`${P}done`)
    await auto.idle()
    expect(runs).toHaveLength(1)
    expect(facet.health()).toMatchObject({ autoEnrich: { queued: 0 } })
  })

  it('still embeds by title and URL when no enricher can be made, and survives Ollama being down', async () => {
    const off = setup({ createFails: true })
    expect(await off.auto.process(`${P}new`)).toEqual({ status: 'not enriched', embedded: true })

    const down = setup({ embedFails: true })
    expect(await down.auto.process(`${P}new`)).toEqual({ status: 'enriched', embedded: false })
    expect(down.vectors.has(`${P}new`)).toBe(false)
    expect(down.auto.needs(await down.search.loadDocument(`${P}new`))).toBe(true) // tried again on the next save
  })

  it('keeps going after one bookmark fails', async () => {
    const { auto, vectors } = setup({ enricher: { async run () { throw new Error('boom') } } })
    auto.enqueue(`${P}new`)
    auto.enqueue(`${P}done`)
    await auto.idle()
    expect(vectors.has(`${P}new`)).toBe(false)
    expect(auto.queue).toHaveLength(0)
  })
})
