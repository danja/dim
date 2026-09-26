import { describe, it, expect } from 'vitest'
import FacetRegistry from '../../../src/common/facets/FacetRegistry.js'
import Router from '../../../src/common/http/Router.js'
import { createServer } from '../../../src/server.js'

const facet = (id, extra = {}) => ({ id, label: id.toUpperCase(), routes () {}, ...extra })

describe('FacetRegistry', () => {
  it('keeps tab order and builds hrefs', () => {
    const registry = new FacetRegistry([facet('b'), facet('a')])
    expect(registry.tabs()).toEqual([
      { id: 'b', label: 'B', href: '/b/' },
      { id: 'a', label: 'A', href: '/a/' }
    ])
  })

  it('rejects bad, duplicate or incomplete facets', () => {
    expect(() => new FacetRegistry([])).toThrow(/at least one/)
    expect(() => new FacetRegistry([facet('Bad')])).toThrow(/lowercase/)
    expect(() => new FacetRegistry([facet('a'), facet('a')])).toThrow(/Duplicate/)
    expect(() => new FacetRegistry([{ id: 'a', label: 'A' }])).toThrow(/routes/)
    expect(() => new FacetRegistry([{ id: 'a', routes () {} }])).toThrow(/label/)
  })

  it('mounts routes with the tab list in context', () => {
    let seen = null
    const registry = new FacetRegistry([facet('a', { routes (router, ctx) { seen = ctx } })])
    registry.mount(new Router(), {})
    expect(seen.tabs).toHaveLength(1)
    expect(seen.facet.id).toBe('a')
  })

  it('collects health, defaulting to ok', async () => {
    const registry = new FacetRegistry([facet('a'), facet('b', { health: () => ({ status: 'planned' }) })])
    expect(await registry.health()).toEqual({ a: { status: 'ok' }, b: { status: 'planned' } })
  })
})

describe('createServer', () => {
  it('refuses a default facet that is not registered', () => {
    expect(() => createServer({ facets: [facet('a')], defaultFacet: 'nope' })).toThrow(/Default facet/)
  })
})
