import { parseOutline, extractLinks } from '../common/outline/OutlineParser.js'
import { nodeIri, newNodeId } from './rdf.js'

/**
 * A parsed Markdown outline → nodes ready to write: ids, parents, positions
 * (1, 2, 3 … per sibling list), source lines, and the URLs each node links
 * to. Nodes with children start collapsed, so a large import opens as a
 * short list of top-level items.
 */
export function planImport (markdown, { outline, now = new Date(), newId = newNodeId }) {
  const { title, items } = parseOutline(markdown)
  const nodes = []
  const walk = (list, parentIri) => {
    list.forEach((item, i) => {
      const id = newId()
      const node = {
        id,
        iri: nodeIri(id),
        outline,
        parent: parentIri,
        position: i + 1,
        title: item.text,
        collapsed: item.children.length > 0,
        created: now.toISOString(),
        line: item.line,
        urls: extractLinks(item.text).map(l => l.url)
      }
      nodes.push(node)
      walk(item.children, node.iri)
    })
  }
  walk(items, outline)
  return { title, nodes }
}
