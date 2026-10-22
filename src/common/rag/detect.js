/**
 * Communities of a graph by label propagation: every node starts with its
 * own label and repeatedly takes the label most common among its neighbours
 * (edge weights counted, each raised by the neighbours the two ends share). Deterministic: nodes are visited in sorted order
 * and a tie keeps the node's own label, else the smallest. Pure; no store.
 *
 * @param {Array<{ a: string, b: string, weight?: number }>} edges undirected
 * → Map label → [node] (largest first), communities under minSize dropped
 */
export function detectCommunities (edges, { minSize = 3, maxRounds = 20 } = {}) {
  const adjacent = new Map()
  const add = (x, y, w) => {
    if (!adjacent.has(x)) adjacent.set(x, new Map())
    adjacent.get(x).set(y, (adjacent.get(x).get(y) ?? 0) + w)
  }
  for (const { a, b, weight = 1 } of edges) {
    if (a === b) continue
    add(a, b, weight)
    add(b, a, weight)
  }
  // An edge inside a tight group (many shared neighbours) outweighs a lone bridge.
  for (const [x, neighbours] of adjacent) {
    for (const [y, w] of neighbours) {
      if (x > y) continue
      const [small, large] = adjacent.get(x).size <= adjacent.get(y).size ? [adjacent.get(x), adjacent.get(y)] : [adjacent.get(y), adjacent.get(x)]
      let common = 0
      for (const n of small.keys()) if (large.has(n)) common++
      neighbours.set(y, w * (1 + common))
      adjacent.get(y).set(x, w * (1 + common))
    }
  }
  const nodes = [...adjacent.keys()].sort()
  const label = new Map(nodes.map(n => [n, n]))

  for (let round = 0; round < maxRounds; round++) {
    let changed = 0
    for (const node of nodes) {
      const votes = new Map()
      for (const [other, w] of adjacent.get(node)) votes.set(label.get(other), (votes.get(label.get(other)) ?? 0) + w)
      const current = label.get(node)
      let best = current
      let bestVote = votes.get(current) ?? 0
      for (const [candidate, vote] of votes) {
        // a tie keeps the node's own label, else the smallest, so it settles
        if (vote > bestVote || (vote === bestVote && best !== current && candidate < best)) { best = candidate; bestVote = vote }
      }
      if (best !== label.get(node)) { label.set(node, best); changed++ }
    }
    if (!changed) break
  }

  const groups = new Map()
  for (const [node, l] of label) groups.set(l, [...(groups.get(l) ?? []), node])
  return new Map([...groups].filter(([, m]) => m.length >= minSize).sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0])))
}

export default detectCommunities
