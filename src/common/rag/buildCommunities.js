import { createHash } from 'crypto'
import { RAG_CONFIG } from '../../../config/preferences.js'
import { detectCommunities } from './detect.js'
import { summariseCommunity } from './summarise.js'

/**
 * Cluster the links graph (links, plus each small topic as a hub joining its
 * members), summarise each cluster and embed the summary. A cluster whose
 * member set is unchanged keeps its earlier LLM summary, so a rerun only
 * pays for what changed. With `similar(iri)` → [{ iri, score }] (see
 * neighbours.js), each node of the graph also gets edges to its nearest
 * embedding neighbours, so clusters form where links are sparse; that costs
 * one embedding per node. → { communities, reused, summarised, fallback }
 */
export async function buildCommunities ({ links, topics = null, registry, embeddings, previous = [], similar = null, baseUrl, config = RAG_CONFIG, onProgress = () => {} }) {
  const c = config.communities
  const edges = (await links.allLinks()).map(l => ({ a: l.from, b: l.to, weight: config.kindWeights[l.kind] ?? 0.5 }))
  for (const topic of (await topics?.list()) ?? []) {
    if (topic.members.length < 2 || topic.members.length > config.topicMembers) continue
    for (const m of topic.members) edges.push({ a: `topic:${topic.iri}`, b: m, weight: config.topicWeight })
  }
  if (similar) {
    const nodes = [...new Set(edges.flatMap(e => [e.a, e.b]))].filter(n => !n.startsWith('topic:'))
    let asked = 0
    for (const iri of nodes) {
      for (const near of await similar(iri)) edges.push({ a: iri, b: near.iri, weight: config.similarity.weight * near.score })
      onProgress({ phase: 'similarity', done: ++asked, total: nodes.length })
    }
  }
  const degree = new Map()
  for (const e of edges) for (const n of [e.a, e.b]) degree.set(n, (degree.get(n) ?? 0) + e.weight)

  const groups = detectCommunities(edges, { minSize: c.minSize })
  const before = new Map(previous.map(p => [p.id, p]))
  const out = []
  const tally = { reused: 0, summarised: 0, fallback: 0 }
  let done = 0
  for (const raw of groups.values()) {
    const members = raw.filter(n => !n.startsWith('topic:')).sort((x, y) => degree.get(y) - degree.get(x) || x.localeCompare(y))
    done++
    if (members.length < c.minSize) continue
    const id = createHash('sha256').update([...members].sort().join('\n')).digest('hex').slice(0, 12)
    const old = before.get(id)
    if (old?.llm && old.vector) { out.push(old); tally.reused++; continue }

    const described = []
    for (const iri of members.slice(0, c.summaryMembers)) {
      const [info, passage] = await Promise.all([registry.lookup(iri), registry.passage(iri)])
      if (info?.href && passage) described.push({ label: info.label, text: passage.text })
    }
    if (described.length < 2) continue
    const titles = described.map(d => d.label).join('; ')
    const llm = await summariseCommunity(described.map(d => d.text), { baseUrl, model: c.summaryModel, maxTokens: c.summaryTokens })
    llm ? tally.summarised++ : tally.fallback++
    const summary = llm ?? `Items including: ${titles}`
    let vector = null
    try { vector = await embeddings.embed(`${summary}\n${titles}`.slice(0, 2000)) } catch { /* no vector: kept, but not searchable until rebuilt */ }
    out.push({ id, size: members.length, summary, llm: Boolean(llm), members, vector })
    onProgress({ phase: 'summaries', done, total: groups.size, ...tally })
  }
  return { communities: out, ...tally }
}

export default buildCommunities
