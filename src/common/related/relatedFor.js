/**
 * "Related" for a detail page: the nearest things in any facet, resolved to
 * labels and pages. null when there's no related index (or it can't answer);
 * renderRelated shows nothing then.
 */
export async function relatedFor ({ services, registry }, iri, text, { k = 6 } = {}) {
  const related = services?.related
  if (!related) return null
  try {
    const hits = await related.related(iri, text, { k })
    const out = []
    for (const h of hits) {
      const found = await registry.lookup(h.iri)
      if (found?.href && found.facet) out.push({ ...found, score: h.score })
    }
    return out
  } catch {
    return null
  }
}

export default relatedFor
