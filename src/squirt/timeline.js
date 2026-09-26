import { iri } from '../common/store/SPARQLHelper.js'
import GraphRegistry from '../common/store/GraphRegistry.js'
import { CHANGES_GRAPH } from '../common/store/ChangeLog.js'

/**
 * Recent activity across DIM: the latest change to each resource from the
 * change log (every facet writes there), plus what facets report through
 * their own recent() hook (e.g. unread news, which isn't change-logged).
 * Resources that no longer resolve (deleted) are skipped.
 *
 * → [{ iri, label, href, at, facet, facetLabel, action, summary }] newest first
 */

const ACTIONS = Object.freeze({ add: 'added', update: 'edited', remove: 'removed', delete: 'deleted' })

export async function recentActivity ({ client, queries, registry, limit = 30, session = null }) {
  const graph = GraphRegistry.graphIri(CHANGES_GRAPH.kind, CHANGES_GRAPH.id)
  let rows = []
  try {
    rows = await client.select(queries.get('changes/recent', { graph: iri(graph), limit: String(limit * 2) }))
  } catch {
    rows = []
  }
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (seen.has(row.resource)) continue
    seen.add(row.resource)
    const found = await registry.lookup(row.resource)
    if (!found?.href || !found.facet) continue
    out.push({ iri: row.resource, label: found.label, href: found.href, at: row.at, facet: found.facet, facetLabel: found.facetLabel, action: ACTIONS[row.action] ?? row.action, summary: row.summary ?? null })
  }
  for (const item of await registry.recent({ limit: Math.min(limit, 8), session })) {
    if (!seen.has(item.iri)) out.push(item)
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, limit)
}
