import { registerRoutes } from './api/routes.js'
import { pagePath } from './api/common.js'
import { tokenise } from '../common/search/LexicalIndex.js'
import { countTags } from '../common/facets/tags.js'

/**
 * Wiki — Markdown pages with full revision history, in graph:facet/wiki.
 * [[Page title]] links to a page (created on follow) and becomes a
 * dim:mentions link, so every page shows what mentions it. See
 * src/common/facets/FacetRegistry.js for the facet contract.
 */

function snippet (content, words) {
  const text = content.replace(/\s+/g, ' ')
  const at = Math.max(0, Math.min(...words.map(w => text.toLowerCase().indexOf(w)).filter(i => i >= 0)) - 40)
  const part = text.slice(at, at + 140)
  return `${at ? '…' : ''}${part}${at + 140 < text.length ? '…' : ''}`
}

export function createWikiFacet ({ store }) {
  if (!store) throw new Error('The wiki needs a WikiStore')
  return {
    id: 'wiki',
    label: 'Wiki',
    description: 'Markdown wiki pages, linked to everything else.',
    types: { page: '/wiki/page/' },

    routes (router, ctx) {
      registerRoutes(router, { store, ...ctx })
    },

    async health () {
      return { status: 'ok', pages: (await store.list()).length }
    },

    async documents () {
      return (await store.list()).map(p => ({ iri: p.iri, text: `${p.title}\n\n${p.content}` }))
    },

    async tags () {
      return countTags((await store.list()).map(p => p.tags))
    },

    async tagged (tag) {
      return (await store.list()).filter(p => p.tags.includes(tag))
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(p => ({ iri: p.iri, label: p.title, href: pagePath(p), snippet: snippet(p.content, []) }))
    },

    async lookup (resourceIri) {
      const page = await store.byIri(resourceIri)
      return page ? { label: page.title, href: pagePath(page), type: 'page' } : null
    },

    async lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      return (await store.list()).find(p => p.title.toLowerCase() === wanted)?.iri ?? null
    },

    /** Every query word in the title, text or tags; title matches first. */
    async find (q, { limit = 10 } = {}) {
      const words = tokenise(q)
      if (!words.length) return []
      const hits = []
      for (const page of await store.list()) {
        const title = page.title.toLowerCase()
        const text = `${title} ${page.content.toLowerCase()} ${page.tags.join(' ')}`
        if (!words.every(w => text.includes(w))) continue
        hits.push({ page, inTitle: words.every(w => title.includes(w)) })
      }
      hits.sort((a, b) => (b.inTitle - a.inTitle) || a.page.title.localeCompare(b.page.title))
      return hits.slice(0, limit).map(({ page }) => ({ iri: page.iri, label: page.title, href: pagePath(page), snippet: snippet(page.content, words) }))
    }
  }
}

export default createWikiFacet
