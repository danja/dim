/**
 * Feed discovery from an HTML page: <link rel="alternate"> with a feed type,
 * then (if none) links whose href looks like a feed. → absolute URLs.
 */

const FEED_TYPES = /application\/(rss|atom|feed)\+(xml|json)|application\/(rdf\+)?xml|application\/json/i

function attr (tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null
}

function absolute (href, base) {
  try {
    const url = new URL(href.replace(/&amp;/g, '&'), base)
    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function discoverFeeds (html, baseUrl) {
  const found = []
  for (const [tag] of String(html ?? '').matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(tag, 'rel') ?? '').toLowerCase().split(/\s+/)
    const type = attr(tag, 'type') ?? ''
    const href = attr(tag, 'href')
    if (href && rel.includes('alternate') && FEED_TYPES.test(type)) found.push({ url: absolute(href, baseUrl), title: attr(tag, 'title'), type })
  }
  if (!found.length) {
    for (const [tag] of String(html ?? '').matchAll(/<a\b[^>]*>/gi)) {
      const href = attr(tag, 'href')
      if (href && /(^|\/)(feed|rss|atom)(\.xml|\.json|\/)?$|\.(rss|atom)$|[?&]feed=(rss2?|atom)/i.test(href.split('#')[0])) found.push({ url: absolute(href, baseUrl), title: null, type: null })
    }
  }
  const seen = new Set()
  return found.filter(f => f.url && !seen.has(f.url) && seen.add(f.url))
}
