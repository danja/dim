import GraphRegistry from './GraphRegistry.js'
import { insertDataQuery, iri, literal } from './SPARQLHelper.js'
import { parseTurtleFile } from '../rdf/TurtleReader.js'
import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * Batched writes into a named graph. Moved out of the bookmark
 * IngestPipeline so every facet writes the same way: triples arrive in
 * groups (one resource per group) and a group is never split across two
 * INSERT DATA requests.
 */

export class GraphWriteError extends Error {
  constructor (message) {
    super(message)
    this.name = 'GraphWriteError'
  }
}

export const BATCH_SIZE = 500

/** An RDF/JS term as a SPARQL term. */
export function termToSparql (term) {
  if (term.termType === 'NamedNode') return iri(term.value)
  if (term.termType === 'BlankNode') return `_:${term.value}`
  if (term.termType === 'Literal') {
    if (term.language) return `${literal(term.value)}@${term.language}`
    if (term.datatype && term.datatype.value !== `${NAMESPACES.xsd}string`) {
      return `${literal(term.value)}^^${iri(term.datatype.value)}`
    }
    return literal(term.value)
  }
  throw new GraphWriteError(`Cannot write a ${term.termType} term`)
}

export class GraphWriter {
  constructor (client, { registry = new GraphRegistry(client), batchSize = BATCH_SIZE } = {}) {
    if (!client) throw new GraphWriteError('GraphWriter needs a SPARQLClient')
    this.client = client
    this.registry = registry
    this.batchSize = batchSize
  }

  /** Write groups of SPARQL triple strings into graph. → triple count. */
  async writeGrouped (graph, groups) {
    let batch = []
    let written = 0
    const flush = async () => {
      if (batch.length === 0) return
      await this.client.update(insertDataQuery(graph, batch))
      written += batch.length
      batch = []
    }
    for (const group of groups) {
      if (batch.length > 0 && batch.length + group.length > this.batchSize) await flush()
      batch.push(...group)
      if (batch.length >= this.batchSize) await flush()
    }
    await flush()
    return written
  }

  /** Replace a registered graph with the contents of a Turtle file. */
  async writeTurtleFile (file, { kind, id, licence, derivedFrom, comment = null }) {
    const dataset = await parseTurtleFile(file)
    const bySubject = new Map()
    for (const quad of dataset) {
      const key = quad.subject.value
      if (!bySubject.has(key)) bySubject.set(key, [])
      bySubject.get(key).push(`${termToSparql(quad.subject)} ${termToSparql(quad.predicate)} ${termToSparql(quad.object)} .`)
    }
    await this.registry.drop(kind, id)
    const graph = await this.registry.register({ kind, id, licence, derivedFrom, comment })
    const written = await this.writeGrouped(graph, [...bySubject.values()])
    return { graph, tripleCount: written }
  }
}

export default GraphWriter
