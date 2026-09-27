/**
 * "Related" for a detail page: the nearest things in any facet (resolved to
 * labels and pages) and the resource's topics. null when there's neither a
 * related index nor topics; renderRelated shows nothing then.
 * → { items: [{ label, href, facetLabel, score }], topics: [{ label, slug }] } | null
 */
export async function relatedFor ({ services, registry }, iri, text, { k = 6 } = {}) {
  const related = services?.related
  const topics = (await services?.topics?.topicsOf(iri).catch(() => [])) ?? []
  const items = []
  if (related) {
    try {
      for (const h of await related.related(iri, text, { k })) {
        const found = await registry.lookup(h.iri)
        if (found?.href && found.facet) items.push({ ...found, score: h.score })
      }
    } catch { /* embeddings unavailable: topics alone */ }
  }
  return items.length || topics.length ? { items, topics } : null
}

export default relatedFor
