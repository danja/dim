/**
 * The facets served by this app, in tab order.
 *
 * A facet is a plain object:
 *
 *   {
 *     id,            // path segment: /<id>/…  (lowercase, hyphens)
 *     label,         // tab text
 *     description,   // one line, shown on its page and in /health
 *     routes (router, ctx),   // registers /<id>/… routes
 *     health ()      // optional: facet status for /health
 *   }
 *
 * The list is explicit (src/facets.js) — no autoloading — so the tab order
 * and what is served are visible in one place.
 */

export class FacetError extends Error {
  constructor (message) {
    super(message)
    this.name = 'FacetError'
  }
}

const ID = /^[a-z][a-z0-9-]*$/

export class FacetRegistry {
  constructor (facets) {
    if (!Array.isArray(facets) || facets.length === 0) {
      throw new FacetError('FacetRegistry needs at least one facet')
    }
    this.facets = []
    const seen = new Set()
    for (const facet of facets) {
      if (!facet || !ID.test(facet.id ?? '')) {
        throw new FacetError(`Facet id must be lowercase alphanumeric with hyphens, got ${JSON.stringify(facet?.id)}`)
      }
      if (seen.has(facet.id)) throw new FacetError(`Duplicate facet id: ${facet.id}`)
      if (!facet.label) throw new FacetError(`Facet ${facet.id} needs a label`)
      if (typeof facet.routes !== 'function') throw new FacetError(`Facet ${facet.id} needs routes(router, ctx)`)
      seen.add(facet.id)
      this.facets.push(facet)
    }
  }

  get (id) {
    return this.facets.find(f => f.id === id) ?? null
  }

  /** Tab list for the page shell: [{ id, label, href }]. */
  tabs () {
    return this.facets.map(({ id, label }) => ({ id, label, href: `/${id}/` }))
  }

  /** Register every facet's routes. ctx is shared; each facet adds its own. */
  mount (router, ctx) {
    for (const facet of this.facets) facet.routes(router, { ...ctx, facet, tabs: this.tabs() })
    return router
  }

  /** Per-facet status for /health. */
  async health () {
    const out = {}
    for (const facet of this.facets) {
      out[facet.id] = typeof facet.health === 'function' ? await facet.health() : { status: 'ok' }
    }
    return out
  }
}

export default FacetRegistry
