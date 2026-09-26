import { esc } from '../common/http/respond.js'
import { renderMarkdown } from '../common/ui/markdown.js'
import { htmlToText } from '../common/text/html.js'

/**
 * Post HTML shared by the app's pages, the Atom feed and the static export.
 * `postHref(post)` says where a post lives in each of those settings.
 */

/** "2026/09/26/slug" — a published post's place, from its publication date (UTC). */
export function datedPath (post) {
  const d = new Date(post.issued ?? post.created)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${post.slug}`
}

/** In the app: dated for published posts, /blog/post/<slug> for drafts. */
export const appPath = post => post.status === 'published' ? `/blog/${datedPath(post)}` : `/blog/post/${post.slug}`

const POST_PATH = /^\/(?:blog\/(?:\d{4}\/\d{2}\/\d{2}|post)|r\/post)\/([a-z0-9-]+)\/?$/

/**
 * Markdown → HTML for a post. publicOnly (feed, export): [[Title]] and local
 * links reach only published posts; anything else becomes plain text, since
 * the rest of DIM is not published. In the app, [[Title]] falls back to the
 * wiki page of that name.
 */
export function postHtml (content, { posts, postHref, publicOnly = false }) {
  const published = posts.filter(p => p.status === 'published')
  const byTitle = new Map(published.map(p => [p.title.toLowerCase(), p]))
  const bySlug = new Map(published.map(p => [p.slug, p]))
  const titleHref = title => {
    const post = byTitle.get(title.toLowerCase())
    if (post) return postHref(post)
    return publicOnly ? null : `/wiki/new?title=${encodeURIComponent(title)}`
  }
  const own = new Set(published.map(postHref))
  const localHref = publicOnly
    ? href => {
      if (own.has(href)) return href
      const m = href.split(/[?#]/)[0].match(POST_PATH)
      const post = m && bySlug.get(m[1])
      return post ? postHref(post) : null
    }
    : null
  return renderMarkdown(content, { titleHref, localHref })
}

/** The abstract, or the start of the text. */
export function excerpt (post, max = 280) {
  if (post.abstract) return post.abstract
  return htmlToText(renderMarkdown(post.content), { max }).split('\n\n')[0] ?? ''
}

export function dateLabel (iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `<time datetime="${esc(d.toISOString())}">${esc(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}</time>`
}

export function tagLinks (tags, tagHref) {
  return tags.map(t => `<a class="tag" href="${esc(tagHref(t))}">${esc(t)}</a>`).join(' ')
}

/** The list of posts (index, tag pages). */
export function postList (posts, { postHref, tagHref }) {
  if (!posts.length) return '<p class="muted">No posts yet.</p>'
  return `<ol class="posts">${posts.map(p => `<li>
<h2><a href="${esc(postHref(p))}">${esc(p.title)}</a>${p.status === 'draft' ? ' <span class="draft-badge">draft</span>' : ''}</h2>
<p class="meta">${dateLabel(p.issued ?? p.created)}${p.tags.length ? ` · ${tagLinks(p.tags, tagHref)}` : ''}</p>
<p>${esc(excerpt(p))}</p>
</li>`).join('\n')}</ol>`
}

/** One post as an article; prev/next are its published neighbours. */
export function postArticle (post, { posts, postHref, tagHref, publicOnly = false, prev = null, next = null }) {
  const nav = prev || next
    ? `<nav class="post-nav" aria-label="More posts">${prev ? `<a rel="prev" href="${esc(postHref(prev))}">← ${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a rel="next" href="${esc(postHref(next))}">${esc(next.title)} →</a>` : ''}</nav>`
    : ''
  return `<article class="post">
<h1>${esc(post.title)}</h1>
<p class="meta">${post.status === 'draft' ? '<span class="draft-badge">draft</span> · not published' : dateLabel(post.issued)}${post.tags.length ? ` · ${tagLinks(post.tags, tagHref)}` : ''}</p>
<div class="post-body">${postHtml(post.content, { posts, postHref, publicOnly })}</div>
</article>
${nav}`
}

/** Published neighbours of a post, by date. */
export function neighbours (post, published) {
  const i = published.findIndex(p => p.slug === post.slug)
  return i === -1 ? {} : { next: published[i - 1] ?? null, prev: published[i + 1] ?? null }
}

/**
 * Atom 1.0 for published posts. absolute(post) → the post's absolute URL;
 * feedUrl, siteUrl absolute too.
 */
export function atomFeed (posts, { title, author, feedUrl, siteUrl, absolute, limit = 20, now = new Date() }) {
  const shown = posts.filter(p => p.status === 'published').slice(0, limit)
  const updated = shown.map(p => p.modified ?? p.issued).sort().at(-1) ?? now.toISOString()
  const iso = v => new Date(v).toISOString()
  const entries = shown.map(p => `  <entry>
    <title>${esc(p.title)}</title>
    <id>${esc(absolute(p))}</id>
    <link rel="alternate" type="text/html" href="${esc(absolute(p))}"/>
    <published>${iso(p.issued)}</published>
    <updated>${iso(p.modified ?? p.issued)}</updated>
${p.tags.map(t => `    <category term="${esc(t)}"/>`).join('\n')}
    <summary>${esc(excerpt(p))}</summary>
    <content type="html">${esc(postHtml(p.content, { posts, postHref: absolute, publicOnly: true }))}</content>
  </entry>`).join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(title)}</title>
  <id>${esc(feedUrl)}</id>
  <link rel="self" type="application/atom+xml" href="${esc(feedUrl)}"/>
  <link rel="alternate" type="text/html" href="${esc(siteUrl)}"/>
  <updated>${iso(updated)}</updated>
  <author><name>${esc(author)}</name></author>
  <generator>DIM</generator>
${entries}
</feed>
`
}
