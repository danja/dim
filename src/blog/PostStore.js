import { iri } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import { slugify } from '../common/rdf/URIMinter.js'
import { POST_PREDICATES, postTriples, postIri } from './rdf.js'

/**
 * Blog posts in graph:facet/blog, in memory (loaded once) and written
 * through. A post is a draft until published; publishing sets its date
 * (dcterms:issued) once — unpublishing and republishing keeps it, so its
 * URL never moves.
 */

export const MAX_TAGS = 12

export class PostError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'PostError'
    this.status = status
  }
}

function cleanTags (value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(raw.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
}

const byDate = (a, b) => (b.issued ?? b.created).localeCompare(a.issued ?? a.created)

export class PostStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('PostStore needs a client and a Repository')
    Object.assign(this, { client, repository, links, queries, now })
    this.posts = null
  }

  async graph () {
    return this.repository.facetGraph('blog', { comment: 'Blog posts (drafts and published)' })
  }

  async all () {
    if (this.posts) return this.posts
    const rows = await this.client.select(this.queries.get('blog/posts', { graph: iri(await this.graph()) }))
    this.posts = new Map(rows.map(r => [r.slug, {
      slug: r.slug,
      iri: r.post,
      title: r.title,
      content: r.content,
      status: r.status,
      issued: r.issued ?? null,
      created: r.created ?? r.issued ?? null,
      modified: r.modified ?? null,
      abstract: r.abstract ?? null,
      derivedFrom: r.derivedFrom ?? null,
      tags: r.tags ? r.tags.split(', ').filter(Boolean) : []
    }]))
    return this.posts
  }

  reset () {
    this.posts = null
  }

  /** Newest first. drafts: include them (the owner's views only). */
  async list ({ drafts = false, tag = null } = {}) {
    return [...(await this.all()).values()]
      .filter(p => (drafts || p.status === 'published') && (!tag || p.tags.includes(tag)))
      .sort(byDate)
  }

  async get (slug) {
    return (await this.all()).get(slug) ?? null
  }

  async byIri (value) {
    const s = String(value ?? '')
    const post = await this.get(s.slice(s.lastIndexOf('/') + 1))
    return post?.iri === s ? post : null
  }

  /** A slug from the title, unique among posts. */
  async freeSlug (title) {
    let base
    try { base = slugify(String(title)) } catch { base = 'post' }
    const posts = await this.all()
    let slug = base
    for (let n = 2; posts.has(slug); n++) slug = `${base}-${n}`
    return slug
  }

  async create ({ title, content = '', tags = [], abstract = null, derivedFrom = null }, actor) {
    const clean = String(title ?? '').trim()
    if (!clean) throw new PostError('A post needs a title')
    const slug = await this.freeSlug(clean)
    const post = { slug, iri: postIri(slug), title: clean, content: String(content).replace(/\r\n/g, '\n'), status: 'draft', issued: null, created: this.now().toISOString(), modified: null, abstract: abstract?.trim() || null, derivedFrom, tags: cleanTags(tags) }
    return this.#write(post, actor, 'new draft')
  }

  async update (post, fields, actor) {
    const next = { ...post, modified: this.now().toISOString() }
    if ('title' in fields) {
      next.title = String(fields.title ?? '').trim()
      if (!next.title) throw new PostError('A post needs a title')
    }
    if ('content' in fields) next.content = String(fields.content ?? '').replace(/\r\n/g, '\n')
    if ('tags' in fields) next.tags = cleanTags(fields.tags)
    if ('abstract' in fields) next.abstract = String(fields.abstract ?? '').trim().slice(0, 1000) || null
    return this.#write(next, actor, `edit ${Object.keys(fields).join(', ')}`)
  }

  /** publish: true to publish (dated now, the first time), false to return to draft. */
  async setPublished (post, publish, actor) {
    const next = { ...post, status: publish ? 'published' : 'draft', issued: post.issued ?? (publish ? this.now().toISOString() : null) }
    return this.#write(next, actor, publish ? 'published' : 'unpublished')
  }

  async delete (post, actor) {
    await this.repository.deleteResources({ graph: await this.graph(), subjects: [post.iri], actor, summary: `deleted post ${post.title}` })
    if (this.links) await this.links.forget([post.iri])
    ;(await this.all()).delete(post.slug)
  }

  async #write (post, actor, summary) {
    await this.repository.replace({ graph: await this.graph(), subject: post.iri, predicates: POST_PREDICATES, triples: postTriples(post), actor, summary })
    ;(await this.all()).set(post.slug, post)
    return post
  }
}

export default PostStore
