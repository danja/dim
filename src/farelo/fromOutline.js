import { plainText } from '../common/outline/OutlineParser.js'

/**
 * Tasks from an outline's TODO sections. An item titled "TODO", "ToDo
 * list", "Misc TODO", "TODO 2013-11-27" … is a heading: each child becomes
 * a task; a child with children of its own becomes a project, and those
 * children its tasks. A TODO heading inside another is handled as a heading
 * in its own right, not as a task. Items that are only a link are skipped
 * (reference material: the task's link to its outline item reaches them).
 */

export const TODO_HEADING = /^(misc\s+)?to-?do(\s+list)?(\s+\d{4}-\d{2}-\d{2})?$/i

/** An item that is only a link is reference material, not a task. */
export function isJustLink (title) {
  const text = String(title ?? '').trim()
  return /^\[[^\]]*\]\(https?:[^)\s]+\)$/.test(text) || /^https?:\/\/\S+$/.test(plainText(text))
}

export function isTodoHeading (title) {
  return TODO_HEADING.test(plainText(title).replace(/[*_@]/g, '').trim())
}

/**
 * outline → [{ node, title, project: node|null, isProject }] in outline
 * order. `childrenOf(parentIri)` returns a node's children in order.
 */
export function planTasks (outline, childrenOf) {
  const out = []
  const seen = new Set()
  const add = (node, extra) => {
    if (seen.has(node.id) || !plainText(node.title) || isJustLink(node.title)) return
    seen.add(node.id)
    out.push({ node, title: node.title, ...extra })
  }
  for (const heading of [...outline.nodes.values()].filter(n => isTodoHeading(n.title))) {
    for (const child of childrenOf(heading.iri)) {
      if (isTodoHeading(child.title)) continue
      const grandchildren = childrenOf(child.iri).filter(g => !isTodoHeading(g.title))
      add(child, { project: null, isProject: grandchildren.length > 0 })
      for (const g of grandchildren) add(g, { project: child, isProject: false })
    }
  }
  return out
}
