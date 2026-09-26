/**
 * The links touching one resource, each resolved to a label and page by the
 * facet that owns the other end. → [link] | { error } | null (no links service).
 * renderLinksPanel (src/common/ui/linksPanel.js) takes any of the three.
 */
export async function resolvedLinks ({ services, registry }, resourceIri) {
  if (!services?.links) return null
  try {
    const links = await services.links.linksOf(resourceIri)
    return Promise.all(links.map(async l => ({ ...(await registry.lookup(l.iri)), kind: l.kind, direction: l.direction, iri: l.iri })))
  } catch (error) {
    return { error: error.message }
  }
}

export default resolvedLinks
