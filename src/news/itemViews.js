/** Pure views over the cached items (NewsStore.itemList / counts). */

export const itemDate = item => item.published ?? item.firstSeen

/**
 * items: Map id → item; feeds: Map slug → feed.
 * view: unread | all | starred; feed: slug; tag: a feed tag; before: ISO
 * date (paging). Newest first. → { items, more }
 */
export function listItems (items, feeds, { view = 'unread', feed = null, tag = null, before = null, limit = 50 } = {}) {
  const feedIris = tag ? new Set([...feeds.values()].filter(f => f.tags.includes(tag)).map(f => f.iri)) : null
  const wanted = feed ? feeds.get(feed)?.iri ?? '-' : null
  const matches = [...items.values()].filter(i =>
    (view === 'all' || (view === 'starred' ? i.starred : !i.read)) &&
    (!wanted || i.feed === wanted) &&
    (!feedIris || feedIris.has(i.feed)) &&
    (!before || itemDate(i) < before))
  matches.sort((a, b) => itemDate(b).localeCompare(itemDate(a)))
  return { items: matches.slice(0, limit), more: matches.length > limit }
}

/** → Map feed iri → { total, unread, starred } */
export function countItems (items) {
  const out = new Map()
  for (const i of items) {
    const c = out.get(i.feed) ?? { total: 0, unread: 0, starred: 0 }
    c.total++
    if (!i.read) c.unread++
    if (i.starred) c.starred++
    out.set(i.feed, c)
  }
  return out
}
