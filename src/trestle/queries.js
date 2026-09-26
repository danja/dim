import { iri } from '../common/store/SPARQLHelper.js'

/** Reading outlines from the store (see OutlineStore for writing). */

const tail = value => value.slice(value.lastIndexOf('/') + 1)

/** Every outline in a graph, with all its nodes. → Map slug → outline */
export async function loadOutlines (client, queries, graph) {
  const rows = await client.select(queries.get('trestle/outlines', { graph: iri(graph) }))
  const outlines = new Map()
  for (const row of rows) {
    const outline = { iri: row.outline, slug: tail(row.outline), title: row.title, created: row.created ?? null, nodes: new Map() }
    const nodes = await client.select(queries.get('trestle/nodes', { graph: iri(graph), outline: iri(row.outline) }))
    for (const n of nodes) {
      const id = tail(n.node)
      outline.nodes.set(id, {
        id,
        iri: n.node,
        title: n.title,
        parent: n.parent,
        position: Number(n.position),
        note: n.note ?? null,
        collapsed: n.collapsed === 'true',
        created: n.created ?? null,
        modified: n.modified ?? null,
        line: n.line != null ? Number(n.line) : null
      })
    }
    outlines.set(outline.slug, outline)
  }
  return outlines
}

/** node IRI → [resource IRIs] from the links graph, in chunks. */
export async function resourcesOf (client, queries, linksGraph, nodes, { chunk = 300 } = {}) {
  const out = new Map()
  for (let i = 0; i < nodes.length; i += chunk) {
    const values = nodes.slice(i, i + chunk).map(n => iri(n.iri)).join(' ')
    const rows = await client.select(queries.get('trestle/resources', { graph: iri(linksGraph), nodes: values }))
    for (const row of rows) {
      if (!out.has(row.node)) out.set(row.node, [])
      out.get(row.node).push(row.resource)
    }
  }
  return out
}
