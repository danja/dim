import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, dropGraphQuery } from './SPARQLHelper.js'
import QueryService from './QueryService.js'
import { SOURCE_PRECEDENCE } from '../../config/preferences.js'

/**
 * Named graphs, provenance and licence. Copied from plugin-universe
 * GraphRegistry, with pu: terms replaced by dim:.
 * Every triple lives in a graph that says where it came from.
 */

export const GRAPH_KINDS = Object.freeze({
  source: { prefix: 'graph:source', precedence: 'registry' },
  vendor: { prefix: 'graph:vendor', precedence: 'vendor' },
  user: { prefix: 'graph:user', precedence: 'user' },
  retrieval: { prefix: 'graph:retrieval', precedence: 'discovery' },
  curated: { prefix: 'graph:curated', precedence: 'curated' },
  alignment: { prefix: 'graph:alignment', precedence: 'curated' },
  system: { prefix: 'graph:system', precedence: 'curated' }
})

export const LICENCES = Object.freeze({
  'CC0-1.0': { redistributable: true, cc0Dump: true, notice: false },
  Unlicense: { redistributable: true, cc0Dump: true, notice: false },
  '0BSD': { redistributable: true, cc0Dump: true, notice: false },
  MIT: { redistributable: true, cc0Dump: false, notice: true },
  ISC: { redistributable: true, cc0Dump: false, notice: true },
  'BSD-2-Clause': { redistributable: true, cc0Dump: false, notice: true },
  'BSD-3-Clause': { redistributable: true, cc0Dump: false, notice: true },
  'Apache-2.0': { redistributable: true, cc0Dump: false, notice: true },
  'BSL-1.0': { redistributable: true, cc0Dump: false, notice: true },
  Zlib: { redistributable: true, cc0Dump: false, notice: true },
  'MPL-2.0': { redistributable: true, cc0Dump: false, notice: true },
  'GPL-2.0': { redistributable: true, cc0Dump: false, notice: true },
  'GPL-3.0': { redistributable: true, cc0Dump: false, notice: true },
  'LGPL-2.1': { redistributable: true, cc0Dump: false, notice: true },
  'LGPL-3.0': { redistributable: true, cc0Dump: false, notice: true },
  'AGPL-3.0': { redistributable: true, cc0Dump: false, notice: true },
  'CC-BY-4.0': { redistributable: true, cc0Dump: false, notice: true },
  'CC-BY-SA-4.0': { redistributable: true, cc0Dump: false, notice: true },
  'proprietary-linkout': { redistributable: false, cc0Dump: false, notice: true },
  'personal-data': { redistributable: false, cc0Dump: false, notice: true },
  unknown: { redistributable: false, cc0Dump: false, notice: true }
})

export class GraphError extends Error {
  constructor (message) {
    super(message)
    this.name = 'GraphError'
  }
}

export class GraphRegistry {
  constructor (client, { metadataGraph = `${NAMESPACES.dim}graphs`, queries = new QueryService() } = {}) {
    if (!client) throw new GraphError('GraphRegistry needs a SPARQLClient')
    this.client = client
    this.metadataGraph = metadataGraph
    this.queries = queries
  }

  static graphIri (kind, id) {
    const spec = GRAPH_KINDS[kind]
    if (!spec) {
      throw new GraphError(`Unknown graph kind "${kind}". Known: ${Object.keys(GRAPH_KINDS).join(', ')}`)
    }
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new GraphError(`Graph id must be lowercase alphanumeric with hyphens, got ${JSON.stringify(id)}`)
    }
    return `${spec.prefix}/${id}`
  }

  static precedenceOf (kind) {
    const spec = GRAPH_KINDS[kind]
    if (!spec) throw new GraphError(`Unknown graph kind "${kind}"`)
    return SOURCE_PRECEDENCE[spec.precedence]
  }

  async register ({ kind, id, licence, derivedFrom, runId = null, comment = null }) {
    if (!licence) {
      throw new GraphError(
        `Graph ${kind}/${id} was registered without a licence. ` +
        `Known: ${Object.keys(LICENCES).join(', ')}`
      )
    }
    if (!(licence in LICENCES)) {
      throw new GraphError(`Unknown licence "${licence}". Known: ${Object.keys(LICENCES).join(', ')}`)
    }
    if (!derivedFrom) {
      throw new GraphError(`Graph ${kind}/${id} must record what it was derived from`)
    }

    const graph = GraphRegistry.graphIri(kind, id)
    const now = new Date()
    const terms = LICENCES[licence]

    const optional = []
    if (runId) optional.push(`dim:harvestRun ${literal(runId)}`)
    if (comment) optional.push(`rdfs:comment ${literal(comment)}`)
    optional.push(`dcterms:title ${literal(id)}`)

    await this.client.update(this.queries.get('graph/deregister', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph)
    }))
    await this.client.update(this.queries.get('graph/register', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph),
      kind: literal(kind),
      identifier: literal(id),
      licence: literal(licence),
      redistributable: typedLiteral(terms.redistributable),
      inCC0Dump: typedLiteral(terms.cc0Dump),
      precedence: typedLiteral(GraphRegistry.precedenceOf(kind)),
      derivedFrom: literal(derivedFrom),
      generatedAtTime: typedLiteral(now),
      optional: optional.join(' ;\n      ') + ' .'
    }))

    return graph
  }

  async list () {
    return this.client.select(this.queries.get('graph/list', {
      metadataGraph: iri(this.metadataGraph)
    }))
  }

  async cc0DumpGraphs () {
    const rows = await this.client.select(this.queries.get('graph/cc0-dump-graphs', {
      metadataGraph: iri(this.metadataGraph)
    }))
    return rows.map(row => row.graph)
  }

  async drop (kind, id) {
    const graph = GraphRegistry.graphIri(kind, id)
    await this.client.update(dropGraphQuery(graph))
    await this.client.update(this.queries.get('graph/deregister', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(graph)
    }))
    return graph
  }

  async isRegistered (kind, id) {
    return this.client.ask(this.queries.get('graph/is-registered', {
      metadataGraph: iri(this.metadataGraph),
      graph: iri(GraphRegistry.graphIri(kind, id))
    }))
  }
}

export default GraphRegistry
