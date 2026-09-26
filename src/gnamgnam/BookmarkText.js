/**
 * The composed text view of a bookmark, used for embeddings and hashing.
 * Link text + URL host + fetched title/description + SKOS type labels +
 * summary + keywords + tags. Moved from common/embeddings/EmbeddingService.js
 * because it is bookmark-specific.
 */

export class BookmarkTextError extends Error {
  constructor (message) {
    super(message)
    this.name = 'BookmarkTextError'
  }
}

function localName (term) {
  if (typeof term !== 'string') {
    throw new BookmarkTextError(`Expected an IRI or a label, got ${typeof term}`)
  }
  const cut = Math.max(term.lastIndexOf('/'), term.lastIndexOf('#'))
  return cut === -1 ? term : term.slice(cut + 1)
}

export function textView (bookmark) {
  if (!bookmark || !bookmark.url) {
    throw new BookmarkTextError('Cannot compose text for a bookmark with no URL')
  }
  let host = null
  try { host = new URL(bookmark.url).hostname } catch { host = null }
  return {
    linkText: bookmark.linkText ?? null,
    url: bookmark.url,
    host,
    title: bookmark.title ?? null,
    description: bookmark.description ?? null,
    summary: bookmark.summary ?? null,
    keywords: bookmark.keywords ?? [],
    bookmarkTypes: (bookmark.bookmarkTypes ?? []).map(localName),
    tags: bookmark.tags ?? [],
    language: bookmark.catalogue?.githubLanguage ?? null,
    topics: [...(bookmark.catalogue?.githubTopic ?? []), ...(bookmark.catalogue?.arxivCategory ?? [])],
    authors: bookmark.catalogue?.arxivAuthor ?? []
  }
}

export function composeText (bookmark) {
  const view = textView(bookmark)
  const parts = []
  if (view.linkText) parts.push(view.linkText)
  if (view.title && view.title !== view.linkText) parts.push(view.title)
  if (view.host) parts.push(`on ${view.host}`)
  if (view.bookmarkTypes.length) parts.push(view.bookmarkTypes.join(', '))
  if (view.description) parts.push(view.description)
  if (view.summary && view.summary !== view.description) parts.push(view.summary)
  if (view.keywords.length) parts.push(view.keywords.join(', '))
  if (view.tags.length) parts.push(view.tags.join(', '))
  // Catalogue details only when present, so bookmarks without them keep
  // the same text (and text hash) as before.
  if (view.language) parts.push(view.language)
  if (view.topics.length) parts.push(view.topics.join(', '))
  if (view.authors.length) parts.push(`by ${view.authors.join(', ')}`)
  parts.push(view.url)
  return parts.join('. ')
}
