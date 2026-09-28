import { createHash } from 'crypto'
import { NAMESPACES } from '../common/rdf/NamespaceManager.js'
import { iri, literal, typedLiteral } from '../common/store/SPARQLHelper.js'
import { slugify } from '../common/rdf/URIMinter.js'

/**
 * Feeds (graph:facet/news) and items (graph:source/news) as triples.
 *
 *   dim:feed/<host-path>-<hash8>     one per feed URL
 *   dim:news-item/<hash16>           one per (feed, guid)
 */

const { dim, rdf, dcterms, schema } = NAMESPACES
const hash = (value, n) => createHash('sha256').update(value, 'utf8').digest('hex').slice(0, n)

export const P = Object.freeze({
  type: rdf + 'type',
  title: dcterms + 'title',
  created: dcterms + 'created',
  issued: dcterms + 'issued',
  description: dcterms + 'description',
  creator: dcterms + 'creator',
  url: schema + 'url',
  feedUrl: dim + 'feedUrl',
  siteUrl: dim + 'siteUrl',
  feedFormat: dim + 'feedFormat',
  tag: dim + 'tag',
  pollStatus: dim + 'pollStatus',
  lastPolled: dim + 'lastPolled',
  nextPoll: dim + 'nextPoll',
  pollFailures: dim + 'pollFailures',
  lastError: dim + 'lastError',
  httpStatus: dim + 'httpStatus',
  etag: dim + 'etag',
  lastModified: dim + 'lastModifiedHeader',
  parked: dim + 'feedParked',
  inFeed: dim + 'inFeed',
  guid: dim + 'guid',
  category: dim + 'category',
  read: dim + 'read',
  starred: dim + 'starred'
})
export const C = Object.freeze({ Feed: dim + 'Feed', FeedItem: dim + 'FeedItem' })

/** What a subscription edit owns, and what a poll owns, on a feed. */
export const FEED_PREDICATES = Object.freeze([P.type, P.feedUrl, P.title, P.siteUrl, P.tag, P.created])
export const POLL_PREDICATES = Object.freeze([P.feedFormat, P.pollStatus, P.lastPolled, P.nextPoll, P.pollFailures, P.lastError, P.httpStatus, P.etag, P.lastModified, P.parked])

export function feedSlug (url) {
  let label = 'feed'
  try {
    const u = new URL(url)
    label = slugify(`${u.hostname.replace(/^www\./, '')}${u.pathname}`.replace(/\/(feed|rss|atom)(\.xml)?\/?$|\.(xml|rss|atom)$/i, '')).slice(0, 40).replace(/-+$/, '') || 'feed'
  } catch { /* not a URL: 'feed' */ }
  return `${label}-${hash(url, 8)}`
}

export const feedIri = slug => `${dim}feed/${slug}`
export const itemId = (feedIriValue, guid) => hash(`${feedIriValue}\n${guid}`, 16)
export const itemIri = id => `${dim}news-item/${id}`
export const slugOf = value => String(value).slice(String(value).lastIndexOf('/') + 1)

export function feedTriples (feed) {
  const s = iri(feed.iri)
  const t = [
    `${s} ${iri(P.type)} ${iri(C.Feed)} .`,
    `${s} ${iri(P.feedUrl)} ${iri(feed.url)} .`,
    `${s} ${iri(P.title)} ${literal(feed.title)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(feed.created))} .`
  ]
  if (feed.siteUrl) t.push(`${s} ${iri(P.siteUrl)} ${iri(feed.siteUrl)} .`)
  for (const tag of feed.tags ?? []) t.push(`${s} ${iri(P.tag)} ${literal(tag)} .`)
  return t
}

export function pollTriples (feed) {
  const s = iri(feed.iri)
  const t = []
  const add = (p, o) => { if (o !== null && o !== undefined && o !== '') t.push(`${s} ${iri(p)} ${o} .`) }
  add(P.feedFormat, feed.format ? literal(feed.format) : null)
  add(P.pollStatus, literal(feed.status ?? 'new'))
  add(P.lastPolled, feed.lastPolled ? typedLiteral(new Date(feed.lastPolled)) : null)
  add(P.nextPoll, feed.nextPoll ? typedLiteral(new Date(feed.nextPoll)) : null)
  add(P.pollFailures, typedLiteral(feed.failures ?? 0))
  add(P.lastError, feed.lastError ? literal(String(feed.lastError).slice(0, 500)) : null)
  add(P.httpStatus, Number.isInteger(feed.httpStatus) && feed.httpStatus >= 100 && feed.httpStatus <= 999 ? typedLiteral(feed.httpStatus) : null)
  add(P.etag, feed.etag ? literal(feed.etag) : null)
  add(P.lastModified, feed.lastModified ? literal(feed.lastModified) : null)
  add(P.parked, typeof feed.parked === 'boolean' ? typedLiteral(feed.parked) : null)
  return t
}

export function itemTriples (item) {
  const s = iri(item.iri)
  const t = [
    `${s} ${iri(P.type)} ${iri(C.FeedItem)} .`,
    `${s} ${iri(P.inFeed)} ${iri(item.feed)} .`,
    `${s} ${iri(P.title)} ${literal(item.title)} .`,
    `${s} ${iri(P.guid)} ${literal(item.guid)} .`,
    `${s} ${iri(P.created)} ${typedLiteral(new Date(item.firstSeen))} .`
  ]
  if (item.link) t.push(`${s} ${iri(P.url)} ${iri(item.link)} .`)
  if (item.published) t.push(`${s} ${iri(P.issued)} ${typedLiteral(new Date(item.published))} .`)
  if (item.summary) t.push(`${s} ${iri(P.description)} ${literal(item.summary)} .`)
  if (item.author) t.push(`${s} ${iri(P.creator)} ${literal(item.author.slice(0, 300))} .`)
  for (const c of item.categories ?? []) t.push(`${s} ${iri(P.category)} ${literal(c.slice(0, 100))} .`)
  return t
}
