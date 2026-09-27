import { registerRoutes } from './api/routes.js'
import { nodePath } from './api/treeView.js'
import { outlinePath } from './api/pages.js'
import { plainText } from '../common/outline/OutlineParser.js'
import { tokenise } from '../common/search/LexicalIndex.js'

/**
 * Trestle — the outliner facet, after danja/trestle. Outlines of nodes with
 * Markdown titles and notes, in graph:facet/trestle. See
 * src/common/facets/FacetRegistry.js for the facet contract.
 */

function label (node) {
  const text = plainText(node.title) || '(untitled)'
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

export function createTrestleFacet ({ store }) {
  if (!store) throw new Error('Trestle needs an OutlineStore')
  return {
    id: 'trestle',
    label: 'Trestle',
    description: 'Outliner: the Workflowy outline, editable, with every link one click away.',
    types: { node: '/trestle/node/', outline: '/trestle/outline/' },

    routes (router, ctx) {
      registerRoutes(router, { store, ...ctx })
    },

    async health () {
      const outlines = await store.list()
      return { status: 'ok', outlines: outlines.length, nodes: outlines.reduce((n, o) => n + o.nodes.size, 0) }
    },

    /** Items with something to say (a title of a few words, or a note). */
    async documents () {
      const out = []
      for (const outline of await store.list()) {
        for (const node of outline.nodes.values()) {
          const text = [plainText(node.title), node.note].filter(Boolean).join('\n\n')
          if (text.length >= 25) out.push({ iri: node.iri, text })
        }
      }
      return out
    },

    async lookup (resourceIri) {
      const found = await store.byIri(resourceIri)
      if (!found) return null
      if (!found.node) return { label: found.outline.title, href: outlinePath(found.outline), type: 'outline' }
      return { label: label(found.node), href: nodePath(found.node), type: 'node' }
    },

    async lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      for (const outline of await store.list()) {
        if (outline.title.toLowerCase() === wanted) return outline.iri
        for (const node of outline.nodes.values()) {
          if (plainText(node.title).toLowerCase() === wanted) return node.iri
        }
      }
      return null
    },

    /** Every query word must appear in the title or note; title matches first. */
    async find (q, { limit = 10 } = {}) {
      const words = tokenise(q)
      if (!words.length) return []
      const hits = []
      for (const outline of await store.list()) {
        for (const node of outline.nodes.values()) {
          const title = plainText(node.title).toLowerCase()
          const text = `${title} ${(node.note ?? '').toLowerCase()}`
          if (!words.every(w => text.includes(w))) continue
          hits.push({ node, outline, inTitle: words.every(w => title.includes(w)) })
        }
      }
      hits.sort((a, b) => (b.inTitle - a.inTitle) || label(a.node).length - label(b.node).length)
      return hits.slice(0, limit).map(({ node, outline }) => ({
        iri: node.iri,
        label: label(node),
        href: nodePath(node),
        snippet: outline.title
      }))
    }
  }
}

export default createTrestleFacet
