import { Readable } from 'stream'
import { rdfParser } from 'rdf-parse'

/**
 * Looking inside a backup's store file (TriG) without a store: triples per
 * graph, and one graph's triples as N-Triples for putting back on its own.
 */

export const DEFAULT_GRAPH = '(default graph)'

function graphName (quad) {
  return quad.graph.termType === 'DefaultGraph' ? DEFAULT_GRAPH : quad.graph.value
}

/** Calls onQuad for every quad in the TriG text. */
export function eachQuad (trig, onQuad) {
  return new Promise((resolve, reject) => {
    rdfParser.parse(Readable.from([trig]), { contentType: 'application/trig' })
      .on('data', onQuad)
      .on('error', reject)
      .on('end', resolve)
  })
}

/** → Map graph IRI → triple count */
export async function graphCounts (trig) {
  const counts = new Map()
  await eachQuad(trig, quad => {
    const g = graphName(quad)
    counts.set(g, (counts.get(g) ?? 0) + 1)
  })
  return counts
}

function escapeLiteral (value) {
  return value.replace(/[\\"\n\r\t]/g, c => ({ '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c])
}

export function ntTerm (term) {
  if (term.termType === 'NamedNode') return `<${term.value}>`
  if (term.termType === 'BlankNode') return `_:${term.value}`
  const text = `"${escapeLiteral(term.value)}"`
  if (term.language) return `${text}@${term.language}`
  if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') return `${text}^^<${term.datatype.value}>`
  return text
}

/** → Map graph IRI → N-Triples text, for the graphs asked for. */
export async function graphsAsNTriples (trig, graphs) {
  const wanted = new Set(graphs)
  const out = new Map(graphs.map(g => [g, []]))
  await eachQuad(trig, quad => {
    const g = graphName(quad)
    if (wanted.has(g)) out.get(g).push(`${ntTerm(quad.subject)} ${ntTerm(quad.predicate)} ${ntTerm(quad.object)} .`)
  })
  return new Map([...out].map(([g, lines]) => [g, lines.join('\n') + (lines.length ? '\n' : '')]))
}

/**
 * The graphs a name means: a full IRI as it is; otherwise every graph whose
 * last path segment is the name ("wiki" → graph:facet/wiki; "news" → both
 * graph:facet/news and graph:source/news).
 */
export function matchGraphs (name, graphs) {
  if (graphs.includes(name)) return [name]
  return graphs.filter(g => g !== DEFAULT_GRAPH && g.split('/').at(-1) === name)
}

/**
 * Backup counts beside the live store's, for a check.
 * → [{ graph, backup, live }] (live null when not known), sorted by graph
 */
export function compareCounts (backup, live = null) {
  const graphs = new Set([...backup.keys(), ...(live ? live.keys() : [])])
  return [...graphs].sort().map(graph => ({ graph, backup: backup.get(graph) ?? 0, live: live ? (live.get(graph) ?? 0) : null }))
}
