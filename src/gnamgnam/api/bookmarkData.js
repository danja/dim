import logger from 'loglevel'
import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'
import { iri } from '../../common/store/SPARQLHelper.js'

/** Bookmark IRIs ↔ public URLs, and the Turtle served for one bookmark. */

export const BOOKMARK_PREFIX = `${NAMESPACES.dim}bookmark/`

/** Where the GnamGnam facet is mounted. */
export const BASE_PATH = '/gnamgnam'

export function bookmarkSlug (bookmarkIri) {
  return String(bookmarkIri ?? '').startsWith(BOOKMARK_PREFIX)
    ? String(bookmarkIri).slice(BOOKMARK_PREFIX.length)
    : null
}

/** Public Turtle URL for a search-result document, e.g. /gnamgnam/bookmark/foo-12345678.ttl */
export function bookmarkDataUrl (doc) {
  const slug = bookmarkSlug(doc?.iri)
  return slug ? `${BASE_PATH}/bookmark/${slug}.ttl` : null
}

/** Minimal hand-built description, used when the store cannot answer. */
export function bookmarkTurtle (doc) {
  const lines = [`@prefix dim: <${NAMESPACES.dim}> .`, `@prefix rdfs: <${NAMESPACES.rdfs}> .`, `@prefix dcterms: <${NAMESPACES.dcterms}> .`, '']
  lines.push(`<${doc.iri}> a dim:Bookmark ;`)
  lines.push(`  rdfs:label "${doc.name.replace(/"/g, '\\"')}" ;`)
  lines.push(`  dim:url <${doc.url}> ;`)
  for (const t of doc.bookmarkTypes ?? []) lines.push(`  dim:bookmarkType <${NAMESPACES.dim}concept/${t}> ;`)
  lines.push('  .')
  return lines.join('\n')
}

/**
 * The saved triples for a bookmark, straight from the store via the
 * bookmark/describe CONSTRUCT. Falls back to the hand-built minimal
 * description when the store cannot answer (offline, empty graph).
 */
export async function savedTurtle (search, bookmarkIri, doc) {
  try {
    const query = search.queries.get('bookmark/describe', { bookmark: iri(bookmarkIri) })
    const turtle = (await search.client.construct(query)).trim()
    if (turtle) return turtle
  } catch (error) {
    logger.warn('[gnamgnam] describe failed, serving in-memory turtle', { bookmarkIri, error: error.message })
  }
  return bookmarkTurtle(doc)
}
