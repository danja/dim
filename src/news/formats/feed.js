import { XMLParser } from 'fast-xml-parser'
import { htmlToText, decodeEntities } from '../../common/text/html.js'
import { feedDate } from './dates.js'

/**
 * RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed → one shape:
 *
 *   { format, title, siteUrl, items: [{ guid, link, title, published, author, summary, categories }] }
 *
 * Tolerant of the usual mess (CDATA, HTML in titles, relative links, missing
 * guids); throws FeedParseError when the document is not a feed at all.
 */

export const SUMMARY_MAX = 4000
export const TITLE_MAX = 500

export { absolute as absoluteUrl }

export class FeedParseError extends Error {
  constructor (message) {
    super(message)
    this.name = 'FeedParseError'
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: name => ['item', 'entry', 'link', 'category', 'atom:link', 'dc:subject', 'author'].includes(name)
})

const list = v => v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]

/** Text of a node: a string, or { '#text' } from an element with attributes. */
function text (node) {
  if (node === undefined || node === null) return ''
  if (Array.isArray(node)) return text(node[0])
  if (typeof node === 'object') return String(node['#text'] ?? '')
  return String(node)
}

function absolute (href, base) {
  const value = String(href ?? '').trim()
  if (!value) return null
  try {
    const url = new URL(value, base || undefined)
    // WHATWG serialisation leaves | ^ etc. in place; they are illegal in an IRI.
    return /^https?:$/.test(url.protocol) ? url.toString().replace(/[<>"{}|^`\\ ]/g, c => encodeURIComponent(c)) : null
  } catch {
    return null
  }
}

const isoDate = feedDate

const cleanTitle = value => htmlToText(value, { max: TITLE_MAX }).replace(/\s+/g, ' ')
/** The fullest of the candidate bodies (description is often a teaser for content). */
function summaryOf (...candidates) {
  const texts = candidates.map(c => htmlToText(text(c), { max: SUMMARY_MAX })).filter(Boolean)
  return texts.sort((a, b) => b.length - a.length)[0] ?? null
}

/** → the item, or null when it has nothing to show (no title, link or text). */
function finishItem (item, base) {
  const link = absolute(item.link, base)
  if (!link && !cleanTitle(item.title) && !item.summary) return null
  const title = cleanTitle(item.title) || (item.summary ? item.summary.slice(0, 80).replace(/\s+/g, ' ') : '') || link || '(untitled)'
  const guid = String(item.guid ?? '').trim() || link || `${title}|${item.published ?? ''}`
  return { guid, link, title, published: item.published, author: item.author || null, summary: item.summary, categories: [...new Set(item.categories.map(c => c.trim()).filter(Boolean))].slice(0, 20) }
}

// ── Atom ─────────────────────────────────────────────────────────────

function atomLink (links, base, rel = 'alternate') {
  const found = list(links).find(l => (l['@_rel'] ?? 'alternate') === rel && (rel !== 'alternate' || !/xml|json/.test(l['@_type'] ?? '')))
  return found ? absolute(found['@_href'], base) : null
}

function parseAtom (feed, base) {
  const siteUrl = atomLink(feed.link, base) ?? absolute(base, null)
  const items = list(feed.entry).map(e => finishItem({
    guid: text(e.id),
    link: atomLink(e.link, siteUrl ?? base),
    title: text(e.title),
    published: isoDate(text(e.published) || text(e.updated) || text(e.issued)),
    author: list(e.author).map(a => text(a.name)).filter(Boolean).join(', '),
    summary: summaryOf(e.summary, e.content),
    categories: list(e.category).map(c => c['@_term'] ?? c['@_label'] ?? text(c))
  }, siteUrl ?? base))
  return { format: 'atom', title: cleanTitle(text(feed.title)), siteUrl, items }
}

// ── RSS 2.0 and 1.0 ──────────────────────────────────────────────────

function rssItems (items, base) {
  return list(items).map(i => {
    const guid = i.guid
    const permalink = guid && typeof guid === 'object' && guid['@_isPermaLink'] !== 'false' ? text(guid) : null
    return finishItem({
      guid: text(guid) || i['@_rdf:about'] || '',
      link: text(i.link) || permalink || i['@_rdf:about'] || '',
      title: text(i.title),
      published: isoDate(text(i.pubDate) || text(i['dc:date']) || text(i.published) || text(i.updated)),
      author: text(i['dc:creator']) || list(i.author).map(text).join(', '),
      summary: summaryOf(i.description, i['content:encoded'], i['media:description']),
      categories: [...list(i.category), ...list(i['dc:subject'])].map(text)
    }, base)
  })
}

function parseRss (rss, base) {
  const channel = rss.channel ?? {}
  const siteUrl = absolute(list(channel.link).map(text).find(Boolean), base)
  return { format: 'rss', title: cleanTitle(text(channel.title)), siteUrl, items: rssItems(channel.item, siteUrl ?? base) }
}

function parseRdf (rdf, base) {
  const channel = rdf.channel ?? {}
  const siteUrl = absolute(text(list(channel.link)[0]), base)
  return { format: 'rdf', title: cleanTitle(text(channel.title)), siteUrl, items: rssItems(rdf.item, siteUrl ?? base) }
}

// ── JSON Feed ────────────────────────────────────────────────────────

function parseJsonFeed (json, base) {
  const siteUrl = absolute(json.home_page_url, base)
  const items = list(json.items).map(i => finishItem({
    guid: String(i.id ?? ''),
    link: i.url ?? i.external_url,
    title: String(i.title ?? ''),
    published: isoDate(i.date_published ?? i.date_modified),
    author: [...list(i.authors), ...list(i.author)].map(a => a?.name).filter(Boolean).join(', '),
    summary: summaryOf(i.summary, i.content_text, i.content_html),
    categories: list(i.tags).map(String)
  }, siteUrl ?? base))
  return { format: 'json', title: cleanTitle(String(json.title ?? '')), siteUrl, items }
}

/** text: the fetched document; url: where it came from (for relative links). */
export function parseFeed (body, { url = null } = {}) {
  const source = String(body ?? '').replace(/^﻿/, '').trim()
  if (!source) throw new FeedParseError('Empty document')
  let feed
  if (source.startsWith('{')) {
    let json
    try { json = JSON.parse(source) } catch (error) { throw new FeedParseError(`Not valid JSON: ${error.message}`) }
    if (!String(json.version ?? '').includes('jsonfeed.org')) throw new FeedParseError('JSON, but not a JSON Feed')
    feed = parseJsonFeed(json, url)
  } else {
    let doc
    try { doc = parser.parse(source) } catch (error) { throw new FeedParseError(`Not well-formed XML: ${error.message}`) }
    if (doc.rss) feed = parseRss(doc.rss, url)
    else if (doc.feed) feed = parseAtom(doc.feed, url)
    else if (doc['rdf:RDF']) feed = parseRdf(doc['rdf:RDF'], url)
    else if (doc['atom:feed']) throw new FeedParseError('Prefixed Atom (atom:feed) is not supported')
    else throw new FeedParseError(/<html/i.test(source.slice(0, 2000)) ? 'An HTML page, not a feed' : 'Not RSS, Atom or JSON Feed')
  }
  return { ...feed, items: feed.items.filter(Boolean), title: feed.title || decodeEntities(feed.siteUrl ?? url ?? '') || 'Untitled feed' }
}
