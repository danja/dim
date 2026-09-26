import { randomUUID } from 'crypto'
import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, typedLiteral, insertDataQuery } from './SPARQLHelper.js'

/**
 * Every write through Repository is recorded as a prov:Activity in
 * graph:system/changes: who, when, what action, which resource in which
 * graph, which properties, and a one-line summary. Enough to show a
 * resource's history later; not a full undo log.
 */

const { dim, prov, rdf, rdfs } = NAMESPACES

export const CHANGES_GRAPH = { kind: 'system', id: 'changes' }

export function changeTriples ({ id, actor, action, graph, subject, predicates = [], summary = null, at }) {
  const s = iri(`${dim}change/${id}`)
  const triples = [
    `${s} ${iri(rdf + 'type')} ${iri(prov + 'Activity')} .`,
    `${s} ${iri(prov + 'startedAtTime')} ${typedLiteral(at)} .`,
    `${s} ${iri(prov + 'wasAssociatedWith')} ${literal(actor)} .`,
    `${s} ${iri(dim + 'changeAction')} ${literal(action)} .`,
    `${s} ${iri(prov + 'used')} ${iri(subject)} .`,
    `${s} ${iri(dim + 'inGraph')} ${iri(graph)} .`
  ]
  for (const p of predicates) triples.push(`${s} ${iri(dim + 'changedProperty')} ${iri(p)} .`)
  if (summary) triples.push(`${s} ${iri(rdfs + 'comment')} ${literal(summary.slice(0, 500))} .`)
  return triples
}

export class ChangeLog {
  constructor ({ client, registry, now = () => new Date() }) {
    if (!client || !registry) throw new Error('ChangeLog needs a client and a GraphRegistry')
    this.client = client
    this.registry = registry
    this.now = now
    this.graph = null
  }

  async #ensureGraph () {
    if (this.graph) return this.graph
    const { kind, id } = CHANGES_GRAPH
    if (!(await this.registry.isRegistered(kind, id))) {
      await this.registry.register({
        kind,
        id,
        licence: 'personal-data',
        derivedFrom: `${dim}changes`,
        comment: 'Who changed what, and when: one prov:Activity per write'
      })
    }
    this.graph = this.registry.constructor.graphIri(kind, id)
    return this.graph
  }

  async record (change) {
    const graph = await this.#ensureGraph()
    const entry = { id: randomUUID(), at: this.now(), ...change }
    await this.client.update(insertDataQuery(graph, changeTriples(entry)))
    return entry
  }
}

export default ChangeLog
