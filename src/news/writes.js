import { iri, typedLiteral, insertDataQuery } from '../common/store/SPARQLHelper.js'
import { P } from './rdf.js'

/**
 * Bulk writes for news that bypass the Repository: items (validated as a
 * batch here), flags and poll status (operational, not change-logged).
 */

const CHUNK = 200

export async function insertGroups (client, graph, groups, per = 50) {
  for (let i = 0; i < groups.length; i += per) await client.update(insertDataQuery(graph, groups.slice(i, i + per).flat()))
}

/** Set or clear a boolean flag (dim:read / dim:starred) on many items. */
export async function writeFlag (client, graph, items, key, value) {
  const triples = items.map(i => `${iri(i.iri)} ${iri(P[key])} ${typedLiteral(true)} .`)
  for (let i = 0; i < triples.length; i += CHUNK) {
    const chunk = triples.slice(i, i + CHUNK).join('\n  ')
    await client.update(`${value ? 'INSERT' : 'DELETE'} DATA { GRAPH ${iri(graph)} {\n  ${chunk}\n} }`)
  }
}

/** Every triple about these subjects, in each graph. */
export async function deleteSubjects (client, graphs, subjects) {
  for (const graph of graphs) {
    for (let i = 0; i < subjects.length; i += CHUNK) {
      const values = subjects.slice(i, i + CHUNK).map(s => iri(s)).join(' ')
      await client.update(`DELETE { GRAPH ${iri(graph)} { ?s ?p ?o } } WHERE { GRAPH ${iri(graph)} { ?s ?p ?o VALUES ?s { ${values} } } }`)
    }
  }
}

/** Replace some predicates of a subject. */
export async function replaceDirect (client, graph, subject, predicates, triples) {
  const values = predicates.map(p => iri(p)).join(' ')
  await client.update(`DELETE { GRAPH ${iri(graph)} { ${iri(subject)} ?p ?o } } WHERE { GRAPH ${iri(graph)} { ${iri(subject)} ?p ?o VALUES ?p { ${values} } } }`)
  if (triples.length) await client.update(insertDataQuery(graph, triples))
}
