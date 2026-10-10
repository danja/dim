import { iri } from '../common/store/SPARQLHelper.js'
import GraphRegistry from '../common/store/GraphRegistry.js'
import { CHANGES_GRAPH } from '../common/store/ChangeLog.js'

/** The newest bookmarks saved in DIM, from the change log. → [{ doc, savedAt }] newest first */
export async function recentBookmarks (search, limit = 20) {
  const graph = GraphRegistry.graphIri(CHANGES_GRAPH.kind, CHANGES_GRAPH.id)
  let rows = []
  try {
    rows = await search.client.select(search.queries.get('bookmark/recent', { graph: iri(graph), limit: String(limit) }))
  } catch {
    return []
  }
  return rows
    .map(row => ({ doc: search.documents.get(row.bookmark), savedAt: row.savedAt }))
    .filter(item => item.doc)
}
