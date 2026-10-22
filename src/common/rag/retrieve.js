import { RAG_CONFIG } from '../../../config/preferences.js'
import { searchEverything } from '../search/everything.js'
import { expand } from './expand.js'

/** A node's nearest embedding neighbours: embeds its passage (cached) and asks the related index. */
const neighbours = (related, registry, { k, minScore }) => async iri => {
  const passage = await registry.passage(iri)
  if (!passage) return []
  try { return await related.related(iri, passage.text, { k, minScore }) } catch { return [] }
}

/** The clusters whose summaries are nearest the question, when that option is on and built. */
async function communityHits (q, { communities, related, config }) {
  if (!config.communities.enabled || !communities || !related) return []
  await communities.refresh()
  if (!communities.size) return []
  const vector = await related.vectorFor(q)
  return vector ? communities.search(vector, { k: config.communities.k, minScore: config.communities.minScore }) : []
}

/**
 * Graph RAG over everything DIM holds: seed with the hybrid search
 * (meaning + words), spread along links and topics, rank, then fetch each
 * item's text from the facet that owns it within a character budget. The
 * caller (an agent, or a prompt) gets cited passages and the links between
 * them; DIM itself generates nothing.
 *
 * → { query, items: [{ iri, label, href, facet, facetLabel, score, hops, seed,
 *       via: [{ label, kind }], text }], edges: [{ from, kind, to }] (IRIs of
 *       items), communities: [{ id, summary, size, score, members }] (option),
 *       semanticError }
 */
export async function retrieve (q, { registry, related = null, links = null, topics = null, hashtags = null, communities = null, config = RAG_CONFIG } = {}) {
  const query = String(q ?? '').trim()
  const seeded = await searchEverything(query, { registry, related, limit: config.seeds })
  const seeds = seeded.results.map(r => ({ iri: r.iri, score: r.score }))
  const similar = related && config.similarity.enabled ? neighbours(related, registry, config.similarity) : null
  const { found, edges } = links && seeds.length ? await expand(seeds, { links, topics, hashtags, similar, config }) : { found: new Map(seeds.map(s => [s.iri, { score: s.score, hops: 0, seed: true, via: [] }])), edges: [] }

  const clusters = await communityHits(q, { communities, related, config })
  for (const hit of clusters) {
    for (const iri of hit.members.slice(0, config.communities.memberLimit)) {
      const boost = hit.score * config.communities.memberBoost
      const node = found.get(iri)
      if (node) { node.score += boost; node.via.push({ from: hit.id, kind: 'community' }) } else found.set(iri, { score: boost, hops: 0, seed: false, via: [{ from: hit.id, kind: 'community' }] })
    }
  }

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
    for (const v of node.via.slice(0, 3)) via.push({ label: v.kind === 'community' ? 'cluster' : (await registry.lookup(v.from))?.label ?? v.from, kind: v.kind })
    items.push({ iri, label: info.label, href: info.href, facet: info.facet, facetLabel: info.facetLabel, score: Math.round(node.score * 1000) / 1000, hops: node.hops, seed: node.seed, via, text })
  }
  const kept = new Set(items.map(i => i.iri))
  return {
    query,
    items,
    edges: edges.filter(e => kept.has(e.from) && kept.has(e.to)),
    communities: clusters.map(({ id, summary, size, score, members }) => ({ id, summary, size, score: Math.round(score * 1000) / 1000, members: members.length })),
    semanticError: seeded.semanticError
  }
}

export default retrieve
