import { RAG_CONFIG } from '../../../config/preferences.js'
import { searchEverything } from '../search/everything.js'
import { expand } from './expand.js'

/**
 * Graph RAG over everything DIM holds: seed with the hybrid search
 * (meaning + words), spread along links and topics, rank, then fetch each
 * item's text from the facet that owns it within a character budget. The
 * caller (an agent, or a prompt) gets cited passages and the links between
 * them; DIM itself generates nothing.
 *
 * → { query, items: [{ iri, label, href, facet, facetLabel, score, hops, seed,
 *       via: [{ label, kind }], text }], edges: [{ from, kind, to }] (IRIs of
 *       items), semanticError }
 */
export async function retrieve (q, { registry, related = null, links = null, topics = null, config = RAG_CONFIG } = {}) {
  const query = String(q ?? '').trim()
  const seeded = await searchEverything(query, { registry, related, limit: config.seeds })
  const seeds = seeded.results.map(r => ({ iri: r.iri, score: r.score }))
  const { found, edges } = links && seeds.length ? await expand(seeds, { links, topics, config }) : { found: new Map(seeds.map(s => [s.iri, { score: s.score, hops: 0, seed: true, via: [] }])), edges: [] }

  const ranked = [...found].sort((a, b) => b[1].score - a[1].score).slice(0, config.limit * 2)
  const items = []
  let used = 0
  for (const [iri, node] of ranked) {
    if (items.length >= config.limit || used >= config.charBudget) break
    const [info, passage] = await Promise.all([registry.lookup(iri), registry.passage(iri)])
    if (!info?.href || !info.facet || !passage) continue // a topic, a gone resource, or a facet with no text
    const text = passage.text.trim().slice(0, Math.min(config.passageChars, config.charBudget - used))
    used += text.length
    const via = []
    for (const v of node.via.slice(0, 3)) via.push({ label: (await registry.lookup(v.from))?.label ?? v.from, kind: v.kind })
    items.push({ iri, label: info.label, href: info.href, facet: info.facet, facetLabel: info.facetLabel, score: Math.round(node.score * 1000) / 1000, hops: node.hops, seed: node.seed, via, text })
  }
  const kept = new Set(items.map(i => i.iri))
  return { query, items, edges: edges.filter(e => kept.has(e.from) && kept.has(e.to)), semanticError: seeded.semanticError }
}

export default retrieve
