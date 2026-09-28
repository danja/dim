import { iri } from '../common/store/SPARQLHelper.js'
import { slugOf } from './rdf.js'
import { shouldPark } from './parking.js'

/** Read feeds, items and flags from the store into Maps (NewsStore's cache). */

const num = v => (v === undefined || v === null || v === '' ? null : Number(v))
const truthy = v => v === true || v === 'true' || v === '1'

function feedFromRow (r) {
  return {
    slug: slugOf(r.feed),
    iri: r.feed,
    url: r.url,
    title: r.title,
    siteUrl: r.siteUrl ?? null,
    tags: r.tags ? r.tags.split(', ').filter(Boolean) : [],
    created: r.created ?? null,
    format: r.format ?? null,
    status: r.status ?? 'new',
    lastPolled: r.lastPolled ?? null,
    nextPoll: r.nextPoll ?? null,
    failures: num(r.failures) ?? 0,
    lastError: r.lastError ?? null,
    httpStatus: num(r.httpStatus),
    etag: r.etag ?? null,
    lastModified: r.lastModified ?? null,
    // Feeds stored before parking existed: parked if they would be now.
    parked: r.parked !== undefined ? truthy(r.parked) : shouldPark({ status: r.status, failures: num(r.failures) ?? 0 })
  }
}

function itemFromRow (r) {
  return {
    id: slugOf(r.item),
    iri: r.item,
    feed: r.feed,
    title: r.title,
    link: r.link ?? null,
    guid: r.guid,
    published: r.published ?? null,
    firstSeen: r.firstSeen,
    author: r.author ?? null,
    snippet: r.snippet ?? null,
    categories: r.categories ? r.categories.split(' | ').filter(Boolean) : [],
    read: false,
    starred: false
  }
}

export async function loadNews (client, queries, { facet, items: itemGraph }) {
  const feeds = new Map((await client.select(queries.get('news/feeds', { graph: iri(facet) }))).map(r => [slugOf(r.feed), feedFromRow(r)]))
  const items = new Map((await client.select(queries.get('news/items', { graph: iri(itemGraph) }))).map(r => [slugOf(r.item), itemFromRow(r)]))
  for (const r of await client.select(queries.get('news/state', { graph: iri(facet) }))) {
    const item = items.get(slugOf(r.item))
    if (!item) continue
    if (r.read !== undefined) item.read = truthy(r.read)
    if (r.starred !== undefined) item.starred = truthy(r.starred)
  }
  return { feeds, items }
}
