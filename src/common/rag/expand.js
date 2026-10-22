import { RAG_CONFIG } from '../../../config/preferences.js'

/**
 * Spread a score from seed resources along the links graph (dim:relatedTo,
 * resource, partOf, mentions) and through shared topics. A node reached from
 * several seeds or by several paths adds up, so what many seeds point at
 * outranks what one does. Each hop is decayed; a node's links are capped by
 * kind strength; topics with many members are skipped as too general.
 *
 * With config.similarity.enabled, `similar(iri)` → [{ iri, score }] adds each
 * node's nearest embedding neighbours as 'similar' edges, weighted by score.
 *
 * → Map iri → { score, hops, seed, via: [{ from, kind }] }, plus `edges`:
 *   [{ from, kind, to }] for every link walked (to show the subgraph).
 */
export async function expand (seeds, { links, topics = null, similar = null, config = RAG_CONFIG } = {}) {
  const found = new Map()
  const edges = []
  for (const { iri, score } of seeds) found.set(iri, { score, hops: 0, seed: true, via: [] })

  let frontier = new Map(seeds.map(s => [s.iri, s.score]))
  for (let hop = 1; hop <= config.hops && frontier.size; hop++) {
    const decay = config.hopDecay ** (hop - 1)
    const linked = await links.linksOfMany([...frontier.keys()])
    const next = new Map()
    const reach = (from, to, kind, gain) => {
      if (!(gain > 0) || from === to) return
      edges.push({ from, kind, to })
      const known = found.get(to)
      if (known?.seed) return
      const entry = known ?? { score: 0, hops: hop, seed: false, via: [] }
      entry.score += gain
      entry.via.push({ from, kind })
      found.set(to, entry)
      if (!known) next.set(to, entry.score)
    }

    for (const [from, score] of frontier) {
      const out = (linked.get(from) ?? [])
        .map(l => ({ ...l, weight: config.kindWeights[l.kind] ?? 0 }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, config.fanout)
      for (const l of out) reach(from, l.iri, l.kind, score * l.weight * decay)

      if (config.similarity?.enabled && similar) {
        for (const near of await similar(from)) reach(from, near.iri, 'similar', score * config.similarity.weight * near.score * decay)
      }

      for (const topic of (await topics?.topicsOf(from)) ?? []) {
        if (topic.members.length > config.topicMembers) continue
        const gain = score * config.topicWeight * decay / Math.sqrt(topic.members.length)
        for (const member of topic.members) reach(from, member, 'topic', gain)
      }
    }
    frontier = next
  }
  return { found, edges }
}

export default expand
