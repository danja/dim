import { NAMESPACES } from '../rdf/NamespaceManager.js'
import { iri, literal, insertDataQuery } from './SPARQLHelper.js'

/**
 * Validated writes into a facet's own named graph (graph:facet/<id>).
 *
 * A change names the resource, the properties it owns, and their new
 * values. The resource's current triples in that graph are read, the named
 * properties replaced in memory, and the result SHACL-validated before
 * anything is written — an invalid change never reaches the store. Every
 * write is recorded in the ChangeLog.
 *
 * User-authored data goes in facet graphs, never in source graphs: an
 * ingest drops and reloads a source graph, and would take edits with it.
 */

export class WriteError extends Error {
  constructor (message, { status = 400, violations = [] } = {}) {
    super(message)
    this.name = 'WriteError'
    this.status = status
    this.violations = violations
  }
}

const TRIPLE = /^(<[^>]*>)\s+<([^>]*)>\s+(.+?)\s*\.\s*$/

/** '<s> <p> o .' → { s, p, o } (s and o as SPARQL terms, p as an IRI). */
export function splitTriple (triple) {
  const m = String(triple).match(TRIPLE)
  if (!m) throw new WriteError(`Not a triple: ${triple}`)
  return { s: m[1], p: m[2], o: m[3] }
}

/** A SPARQL JSON result binding → a SPARQL term. */
export function bindingToTerm (node) {
  if (node.type === 'uri') return iri(node.value)
  if (node.type === 'literal' || node.type === 'typed-literal') {
    if (node['xml:lang']) return `${literal(node.value)}@${node['xml:lang']}`
    if (node.datatype && node.datatype !== `${NAMESPACES.xsd}string`) return `${literal(node.value)}^^${iri(node.datatype)}`
    return literal(node.value)
  }
  return null // blank nodes are never written by facets
}

export class Repository {
  constructor ({ client, validator, changeLog, registry }) {
    for (const [key, value] of Object.entries({ client, validator, changeLog, registry })) {
      if (!value) throw new Error(`Repository needs ${key}`)
    }
    this.client = client
    this.validator = validator
    this.changeLog = changeLog
    this.registry = registry
    this.known = new Set()
  }

  /** Register graph:facet/<id> once, the first time a facet writes. → graph IRI */
  async facetGraph (id, { comment = null } = {}) {
    const graph = this.registry.constructor.graphIri('facet', id)
    if (this.known.has(graph)) return graph
    if (!(await this.registry.isRegistered('facet', id))) {
      await this.registry.register({
        kind: 'facet',
        id,
        licence: 'personal-data',
        derivedFrom: `${NAMESPACES.dim}facet/${id}`,
        comment: comment ?? `Data authored in the ${id} facet`
      })
    }
    this.known.add(graph)
    return graph
  }

  /** A resource's triples in one graph, as SPARQL triple strings. */
  async describe (graph, subject) {
    const result = await this.client.query(`SELECT ?p ?o WHERE { GRAPH ${iri(graph)} { ${iri(subject)} ?p ?o } }`)
    const triples = []
    for (const b of result.results.bindings) {
      const o = bindingToTerm(b.o)
      if (o) triples.push(`${iri(subject)} ${iri(b.p.value)} ${o} .`)
    }
    return triples
  }

  async #validate (triples) {
    const report = await this.validator.validateTriples(triples)
    if (!report.conforms) {
      const violations = [...new Set(report.results.map(r => r.path ? `${r.message} (${String(r.path).replace(/^.*[/#]/, '')})` : r.message))]
      throw new WriteError(`Rejected by the shapes: ${violations[0] ?? 'does not conform'}`, { status: 422, violations })
    }
  }

  /**
   * Replace `predicates` of `subject` in `graph` with `triples` (which may be
   * empty: that clears them). Other properties of the resource are kept.
   */
  async replace ({ graph, subject, predicates, triples = [], actor, summary = null }) {
    if (!predicates?.length) throw new WriteError('replace() needs the predicates it owns')
    const owned = new Set(predicates)
    for (const t of triples) {
      const { s, p } = splitTriple(t)
      if (s !== iri(subject)) throw new WriteError(`Triple is not about ${subject}: ${t}`)
      if (!owned.has(p)) throw new WriteError(`Triple uses ${p}, which this change does not own`)
    }
    const current = await this.describe(graph, subject)
    const kept = current.filter(t => !owned.has(splitTriple(t).p))
    await this.#validate([...kept, ...triples])

    const values = predicates.map(p => `(${iri(p)})`).join(' ')
    let update = `DELETE { GRAPH ${iri(graph)} { ${iri(subject)} ?p ?o } }
WHERE { GRAPH ${iri(graph)} { ${iri(subject)} ?p ?o VALUES (?p) { ${values} } } }`
    if (triples.length) update += ` ;\n${insertDataQuery(graph, triples)}`
    await this.client.update(update)
    await this.changeLog.record({ actor, action: 'update', graph, subject, predicates, summary })
    return { graph, subject, triples }
  }

  /** Add triples (all about `subject`) to a graph, validating the resource afterwards. */
  async add ({ graph, subject, triples, actor, summary = null }) {
    if (!triples?.length) throw new WriteError('add() needs triples')
    for (const t of triples) {
      if (splitTriple(t).s !== iri(subject)) throw new WriteError(`Triple is not about ${subject}: ${t}`)
    }
    const current = await this.describe(graph, subject)
    await this.#validate([...current, ...triples])
    await this.client.update(insertDataQuery(graph, triples))
    await this.changeLog.record({ actor, action: 'add', graph, subject, predicates: [...new Set(triples.map(t => splitTriple(t).p))], summary })
    return { graph, subject, triples }
  }

  /** Remove exact triples (all about `subject`) from a graph. */
  async remove ({ graph, subject, triples, actor, summary = null }) {
    if (!triples?.length) throw new WriteError('remove() needs triples')
    for (const t of triples) {
      if (splitTriple(t).s !== iri(subject)) throw new WriteError(`Triple is not about ${subject}: ${t}`)
    }
    await this.client.update(`DELETE DATA { GRAPH ${iri(graph)} {\n  ${triples.join('\n  ')}\n} }`)
    await this.changeLog.record({ actor, action: 'remove', graph, subject, predicates: [...new Set(triples.map(t => splitTriple(t).p))], summary })
    return { graph, subject, triples }
  }
}

export default Repository
