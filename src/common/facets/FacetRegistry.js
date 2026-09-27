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
 *     refresh (iri),         // optional: a resource it shows changed elsewhere
 *     recent ({ limit }),    // optional: → [{ iri, label, href, at, action }] not in the change log
 *     aboutDomain (host),    // optional: → [{ label, href }] what it has from a site
 *     urlStatus (url),       // optional: → { status, href, label, archivedAt } for a URL it tracks
 *     tags (),               // optional: → Map tag → count
 *     tagged (tag),          // optional: → [{ iri, label, href, snippet }]
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

  /** What every facet has from one site (e.g. bookmarks, a feed). → [{ facet, facetLabel, label, href }] */
  async aboutDomain (host) {
    const out = []
    if (!host) return out
    for (const facet of this.facets) {
      try {
        for (const item of (await facet.aboutDomain?.(host)) ?? []) out.push({ facet: facet.id, facetLabel: facet.label, ...item })
      } catch { /* one facet failing must not hide the others */ }
    }
    return out
  }

  /** Is this URL tracked (bookmarked), and how was it when last checked? */
  async urlStatus (url) {
    for (const facet of this.facets) {
      const found = await facet.urlStatus?.(url)
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

  /** What facets report as recent through recent() (not the change log). */
  async recent (options = {}) {
    const out = []
    for (const facet of this.facets) {
      try {
        for (const item of (await facet.recent?.(options)) ?? []) out.push({ facet: facet.id, facetLabel: facet.label, ...item })
      } catch { /* one facet's failure must not hide the others */ }
    }
    return out
  }

  /** Every tag in use, across facets. → [{ tag, count, facets: [label] }] by count */
  async tags () {
    const all = new Map()
    for (const facet of this.facets) {
      let counts
      try { counts = await facet.tags?.() } catch { counts = null }
      for (const [tag, n] of counts ?? []) {
        const entry = all.get(tag) ?? { tag, count: 0, facets: [] }
        entry.count += n
        entry.facets.push(facet.label)
        all.set(tag, entry)
      }
    }
    return [...all.values()].sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
  }

  /** Everything with a tag. → [{ facet, label, results }] */
  async tagged (tag) {
    const groups = []
    for (const facet of this.facets) {
      try {
        const results = (await facet.tagged?.(tag)) ?? []
        if (results.length) groups.push({ facet: facet.id, label: facet.label, results })
      } catch { /* one facet failing must not hide the others */ }
    }
    return groups
  }

  /** Tell every facet that caches resources that this one changed. */
  async refresh (resourceIri) {
    for (const facet of this.facets) await facet.refresh?.(resourceIri)
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
      try {
        out[facet.id] = typeof facet.health === 'function' ? await facet.health() : { status: 'ok' }
      } catch (error) {
        out[facet.id] = { status: 'error', error: error.message }
      }
    }
    return out
  }
}

export default FacetRegistry
