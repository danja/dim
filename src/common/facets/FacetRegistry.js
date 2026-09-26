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
 *     health (),             // optional: facet status for /health
 *     types,                 // optional: { type: '/path/to/' } — resources it owns,
 *                            //   IRIs dim:<type>/<slug>, pages <path><slug>
 *     lookup (iri),          // optional: → { label, href, type } | null
 *     lookupUrl (url),       // optional: an external URL it holds → IRI | null
 *     lookupTitle (title),   // optional: exact title → IRI | null
 *     find (q, { limit })    // optional: → [{ iri, label, href, snippet }]
 *   }
 *
 * The list is explicit (src/facets.js) — no autoloading — so the tab order
 * and what is served are visible in one place.
 */

import { typeSlugOf, iriFor } from '../links/mentions.js'

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
    this.typePaths = new Map()
    for (const facet of this.facets) {
      for (const [type, path] of Object.entries(facet.types ?? {})) {
        if (this.typePaths.has(type)) throw new FacetError(`Resource type ${type} is claimed by two facets`)
        this.typePaths.set(type, { facet, path })
      }
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

  /** The page for a resource IRI, or null when no facet owns its type. */
  href (resourceIri) {
    const ts = typeSlugOf(resourceIri)
    const owner = ts && this.typePaths.get(ts.type)
    return owner ? `${owner.path}${ts.slug}` : null
  }

  /** A DIM page path → the IRI of the resource it shows, or null. */
  iriFromPath (path) {
    for (const [type, { path: prefix }] of this.typePaths) {
      if (path.startsWith(prefix)) {
        const slug = path.slice(prefix.length)
        if (/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(slug)) return iriFor(type, slug)
      }
    }
    return null
  }

  iriFromUrl (url) {
    for (const facet of this.facets) {
      const found = facet.lookupUrl?.(url)
      if (found) return found
    }
    return null
  }

  async resolveTitle (title) {
    for (const facet of this.facets) {
      const found = await facet.lookupTitle?.(title)
      if (found) return found
    }
    return null
  }

  /** → { iri, label, href, type, facet, facetLabel } for any IRI. */
  async lookup (resourceIri) {
    for (const facet of this.facets) {
      const found = await facet.lookup?.(resourceIri)
      if (found) return { iri: resourceIri, facet: facet.id, facetLabel: facet.label, ...found }
    }
    const ts = typeSlugOf(resourceIri)
    if (ts) return { iri: resourceIri, label: `${ts.type}/${ts.slug}`, href: this.href(resourceIri), type: ts.type, facet: null, facetLabel: null }
    return { iri: resourceIri, label: resourceIri, href: /^https?:/.test(resourceIri) ? resourceIri : null, type: null, facet: null, facetLabel: null }
  }

  /** Search every facet that can. → [{ facet, label, results }] */
  async find (q, { limit = 10 } = {}) {
    const groups = []
    for (const facet of this.facets) {
      if (typeof facet.find !== 'function') continue
      // One facet failing (e.g. no embedding service) must not hide the others.
      try {
        const results = await facet.find(q, { limit })
        if (results.length) groups.push({ facet: facet.id, label: facet.label, results })
      } catch (error) {
        groups.push({ facet: facet.id, label: facet.label, results: [], error: error.message })
      }
    }
    return groups
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
