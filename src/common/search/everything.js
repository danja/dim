/**
 * Search everything DIM holds, one ranked list: by meaning (the related
 * index, which holds wiki pages, tasks, outline items, posts and news items,
 * beside the bookmark index) and by words (each facet's own find). A hit
 * found both ways ranks highest; words alone still count, so exact names,
 * and everything when Ollama is down, are found.
 *
 * → { results: [{ iri, label, href, snippet, facet, facetLabel, score, by }],
 *     facets: [{ facet, label, count }], semanticError }
 * by: 'meaning' | 'words' | 'both'
 */

export const SEARCH = Object.freeze({
  semanticK: 40, // nearest neighbours asked for
  semanticMinScore: 0.5, // below this a short query's neighbours are mostly noise
  wordsPerFacet: 10,
  wordsWeight: 0.35, // a facet's top word match counts like this much similarity
  bothBonus: 0.15
})

export async function searchEverything (q, { registry, related = null, facet = null, limit = 30, config = SEARCH } = {}) {
  const query = String(q ?? '').trim()
  if (!query) return { results: [], facets: [], semanticError: null }

  let semanticError = null
  const [groups, near] = await Promise.all([
    registry.find(query, { limit: config.wordsPerFacet }),
    related
      ? related.search(query, { k: config.semanticK, minScore: config.semanticMinScore }).catch(error => { semanticError = error.message; return [] })
      : []
  ])
  if (related && !near.length && related.downUntil > Date.now()) semanticError = 'embeddings unavailable (Ollama)'

  const hits = new Map()
  for (const g of groups) {
    g.results.forEach((r, rank) => {
      const words = config.wordsWeight * (1 - rank / (config.wordsPerFacet * 2))
      hits.set(r.iri, { iri: r.iri, label: r.label, href: r.href, snippet: r.snippet ?? null, facet: g.facet, facetLabel: g.label, words, meaning: 0 })
    })
  }
  for (const n of near) {
    const known = hits.get(n.iri)
    if (known) {
      known.meaning = n.score
      continue
    }
    const found = await registry.lookup(n.iri)
    if (!found?.href || !found.facet) continue
    hits.set(n.iri, { iri: n.iri, label: found.label, href: found.href, snippet: found.snippet ?? null, facet: found.facet, facetLabel: found.facetLabel, words: 0, meaning: n.score })
  }

  const all = [...hits.values()].map(h => {
    const by = h.words && h.meaning ? 'both' : h.meaning ? 'meaning' : 'words'
    const score = h.meaning + h.words + (by === 'both' ? config.bothBonus : 0)
    return { iri: h.iri, label: h.label, href: h.href, snippet: h.snippet, facet: h.facet, facetLabel: h.facetLabel, score: Math.round(score * 1000) / 1000, by }
  }).sort((a, b) => b.score - a.score)

  const counts = new Map()
  for (const r of all) counts.set(r.facet, { facet: r.facet, label: r.facetLabel, count: (counts.get(r.facet)?.count ?? 0) + 1 })
  const results = (facet ? all.filter(r => r.facet === facet) : all).slice(0, limit)
  return { results, facets: [...counts.values()].sort((a, b) => b.count - a.count), semanticError }
}

export default searchEverything
