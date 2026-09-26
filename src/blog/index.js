import { registerRoutes } from './api/routes.js'
import { appPath, excerpt } from './render.js'
import { tokenise } from '../common/search/LexicalIndex.js'
import { countTags } from '../common/facets/tags.js'

/**
 * Blog — posts written here or started from a wiki page or outline item,
 * published at dated URLs with an Atom feed, and exported as a static site
 * (bin/blog-export.js) for hosting elsewhere. graph:facet/blog.
 *
 * wiki / outlines: the WikiStore and OutlineStore posts can start from.
 */

export function createBlogFacet ({ store, wiki = null, outlines = null, title = 'Blog', author = 'owner' }) {
  if (!store) throw new Error('The blog needs a PostStore')
  return {
    id: 'blog',
    label: 'Blog',
    description: 'Blog: publish wiki pages and outline items as posts; Atom feed; static export.',
    types: { post: '/blog/post/' },

    routes (router, ctx) {
      registerRoutes(router, { store, wiki, outlines, blogTitle: title, blogAuthor: author, ...ctx })
    },

    async health () {
      const all = await store.list({ drafts: true })
      return { status: 'ok', published: all.filter(p => p.status === 'published').length, drafts: all.filter(p => p.status === 'draft').length }
    },

    /** Published posts only, like find. */
    async tags () {
      return countTags((await store.list()).map(p => p.tags))
    },

    async tagged (tag) {
      return (await store.list({ tag })).map(p => ({ iri: p.iri, label: p.title, href: appPath(p), snippet: excerpt(p, 160) }))
    },

    async lookup (resourceIri) {
      const post = await store.byIri(resourceIri)
      return post ? { label: post.status === 'draft' ? `${post.title} (draft)` : post.title, href: appPath(post), type: 'post' } : null
    },

    async lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      return (await store.list()).find(p => p.title.toLowerCase() === wanted)?.iri ?? null
    },

    /** Published posts only: /find is not behind a login. */
    async find (q, { limit = 10 } = {}) {
      const words = tokenise(q)
      if (!words.length) return []
      const hits = (await store.list()).filter(p => {
        const text = `${p.title} ${p.content} ${p.tags.join(' ')}`.toLowerCase()
        return words.every(w => text.includes(w))
      })
      return hits.slice(0, limit).map(p => ({ iri: p.iri, label: p.title, href: appPath(p), snippet: excerpt(p, 160) }))
    }
  }
}

export default createBlogFacet
