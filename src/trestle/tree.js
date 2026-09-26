/**
 * Pure outline operations over an in-memory outline:
 *
 *   outline = { iri, nodes: Map<id, node> }
 *   node    = { id, iri, parent (IRI of node or outline), position, … }
 *
 * Order among siblings is by `position`, a decimal: inserting between two
 * siblings takes the midpoint, so a move or insert rewrites one node, not
 * the whole sibling list. When two neighbours get too close, `renumber`
 * spreads a sibling list back out (rare).
 */

export const MIN_GAP = 1e-6

export class TreeError extends Error {
  constructor (message) {
    super(message)
    this.name = 'TreeError'
    this.status = 400
  }
}

export function childrenOf (outline, parentIri) {
  const out = []
  for (const node of outline.nodes.values()) if (node.parent === parentIri) out.push(node)
  return out.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
}

/** A position strictly between `before` and `after` (either may be null). */
export function positionBetween (before, after) {
  if (before == null && after == null) return 1
  if (before == null) return after - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

export function needsRenumber (before, after) {
  return before != null && after != null && after - before < MIN_GAP
}

/** Evenly spaced positions for a sibling list: 1, 2, 3 … → [{ node, position }] */
export function renumber (siblings) {
  return siblings.map((node, i) => ({ node, position: i + 1 }))
}

function siblingsAround (outline, node) {
  const siblings = childrenOf(outline, node.parent)
  const i = siblings.findIndex(n => n.id === node.id)
  return { siblings, i }
}

/** Where a new node goes: first child of parent, or right after a sibling. */
export function insertPlace (outline, { parent, after = null }) {
  if (after) {
    const anchor = outline.nodes.get(after)
    if (!anchor) throw new TreeError('No such node to insert after')
    const { siblings, i } = siblingsAround(outline, anchor)
    return { parent: anchor.parent, before: anchor.position, after: siblings[i + 1]?.position ?? null }
  }
  const kids = childrenOf(outline, parent)
  return { parent, before: kids.at(-1)?.position ?? null, after: null }
}

/**
 * Structural moves → { parent, before, after } for the moved node, or null
 * when the move is not possible (first child can't indent, top level can't
 * outdent, first can't go up, last can't go down).
 */
export function planMove (outline, node, op) {
  const { siblings, i } = siblingsAround(outline, node)
  switch (op) {
    case 'indent': {
      const prev = siblings[i - 1]
      if (!prev) return null
      const kids = childrenOf(outline, prev.iri)
      return { parent: prev.iri, before: kids.at(-1)?.position ?? null, after: null, expand: prev }
    }
    case 'outdent': {
      if (node.parent === outline.iri) return null
      const parent = [...outline.nodes.values()].find(n => n.iri === node.parent)
      if (!parent) return null
      const { siblings: parentSiblings, i: pi } = siblingsAround(outline, parent)
      return { parent: parent.parent, before: parent.position, after: parentSiblings[pi + 1]?.position ?? null }
    }
    case 'up': {
      if (i === 0) return null
      return { parent: node.parent, before: siblings[i - 2]?.position ?? null, after: siblings[i - 1].position }
    }
    case 'down': {
      if (i === siblings.length - 1) return null
      return { parent: node.parent, before: siblings[i + 1].position, after: siblings[i + 2]?.position ?? null }
    }
    default:
      throw new TreeError(`Unknown move ${JSON.stringify(op)}; use indent, outdent, up or down`)
  }
}

/** The node and all its descendants, depth first. */
export function subtree (outline, node) {
  const out = [node]
  for (const child of childrenOf(outline, node.iri)) out.push(...subtree(outline, child))
  return out
}

/** Ancestors from the top down (not including the node). */
export function ancestors (outline, node) {
  const byIri = new Map([...outline.nodes.values()].map(n => [n.iri, n]))
  const out = []
  let current = byIri.get(node.parent)
  while (current) {
    out.unshift(current)
    current = byIri.get(current.parent)
  }
  return out
}

/** Titles as a Markdown bullet list (notes omitted), for export. */
export function toMarkdown (outline, parentIri, depth = 0) {
  return childrenOf(outline, parentIri)
    .map(node => `${'  '.repeat(depth)}- ${node.title}\n${toMarkdown(outline, node.iri, depth + 1)}`)
    .join('')
}
