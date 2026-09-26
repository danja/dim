import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri } from '../store/SPARQLHelper.js'
import QueryService from '../store/QueryService.js'

/**
 * Links between any two resources, in any facets, kept in one shared graph
 * (graph:facet/links) so they survive a facet reloading its own graph and
 * can be read in both directions with one query.
 *
 *   related  dim:relatedTo  symmetric — shown on both ends as "related"
 *   resource dim:resource   "useful for": task → bookmark, note → page
 *   partOf   dim:partOf     containment
 *   mentions dim:mentions   derived from Markdown on save; not added by hand
 */

const { dim } = NAMESPACES

export const LINK_KINDS = Object.freeze({
  related: { predicate: dim + 'relatedTo', label: 'Related', inverse: 'Related' },
  resource: { predicate: dim + 'resource', label: 'Resources', inverse: 'Used by' },
  partOf: { predicate: dim + 'partOf', label: 'Part of', inverse: 'Contains' },
  mentions: { predicate: dim + 'mentions', label: 'Mentions', inverse: 'Mentioned by' }
})

export const USER_LINK_KINDS = Object.freeze(['related', 'resource', 'partOf'])

const KIND_BY_PREDICATE = new Map(Object.entries(LINK_KINDS).map(([kind, { predicate }]) => [predicate, kind]))

export class LinkError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'LinkError'
    this.status = status
  }
}

export class LinkStore {
  constructor ({ client, repository, queries = new QueryService() }) {
    if (!client || !repository) throw new Error('LinkStore needs a client and a Repository')
    this.client = client
    this.repository = repository
    this.queries = queries
  }

  async graph () {
    return this.repository.facetGraph('links', { comment: 'Links between resources across facets' })
  }

  #triple (from, kind, to) {
    const spec = LINK_KINDS[kind]
    if (!spec) throw new LinkError(`Unknown link kind ${JSON.stringify(kind)}; use ${Object.keys(LINK_KINDS).join(', ')}`)
    if (!from || !to) throw new LinkError('A link needs both ends')
    if (from === to) throw new LinkError('A resource cannot link to itself')
    return `${iri(from)} ${iri(spec.predicate)} ${iri(to)} .`
  }

  async add ({ from, kind, to, actor }) {
    if (!USER_LINK_KINDS.includes(kind)) throw new LinkError(`${kind} links are derived, not added by hand`)
    const graph = await this.graph()
    return this.repository.add({ graph, subject: from, triples: [this.#triple(from, kind, to)], actor, summary: `link ${kind} → ${to}` })
  }

  async remove ({ from, kind, to, actor }) {
    const graph = await this.graph()
    return this.repository.remove({ graph, subject: from, triples: [this.#triple(from, kind, to)], actor, summary: `unlink ${kind} → ${to}` })
  }

  /** Replace everything `from` mentions with `targets` (from its Markdown). */
  async syncMentions ({ from, targets, actor }) {
    const graph = await this.graph()
    const unique = [...new Set(targets)].filter(t => t && t !== from)
    return this.repository.replace({
      graph,
      subject: from,
      predicates: [LINK_KINDS.mentions.predicate],
      triples: unique.map(to => this.#triple(from, 'mentions', to)),
      actor,
      summary: `mentions: ${unique.length}`
    })
  }

  /** Drop every link to or from these resources (they are being deleted). */
  async forget (resources, { chunk = 200 } = {}) {
    if (!resources?.length) return
    const graph = await this.graph()
    for (let i = 0; i < resources.length; i += chunk) {
      const values = resources.slice(i, i + chunk).map(r => iri(r)).join(' ')
      await this.client.update(`DELETE { GRAPH ${iri(graph)} { ?s ?p ?o } }
WHERE { GRAPH ${iri(graph)} { { ?s ?p ?o VALUES ?s { ${values} } } UNION { ?s ?p ?o VALUES ?o { ${values} } } } }`)
    }
  }

  /** → [{ kind, direction: 'out'|'in', iri }] for one resource. */
  async linksOf (resource) {
    const graph = await this.graph()
    const rows = await this.client.select(this.queries.get('links/of', { graph: iri(graph), resource: iri(resource) }))
    const seen = new Set()
    const out = []
    for (const row of rows) {
      const kind = KIND_BY_PREDICATE.get(row.p)
      if (!kind) continue
      // relatedTo is symmetric: one "related" entry whichever way it was stored.
      const direction = kind === 'related' ? 'out' : row.direction
      const key = `${kind}|${direction}|${row.other}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind, direction, iri: row.other })
    }
    return out
  }
}

export default LinkStore
