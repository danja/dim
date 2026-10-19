import { normaliseUrl } from './BookmarkNormaliser.js'

/**
 * Parse a browser's bookmark export (the Netscape HTML file Chrome, Edge,
 * Firefox and Safari all write). Folders become tags; the bookmarks bar and
 * "Other bookmarks" containers are not tags. Non-http(s) links (javascript:,
 * place:, about:) are dropped, and a URL appearing twice is kept once.
 * → [{ url, title, tags }]
 */

const CONTAINERS = /^(bookmarks?( bar| menu| toolbar)?|other bookmarks|mobile bookmarks|favou?rites( bar)?|bookmarks toolbar|reading list)$/i
const TOKEN = /<h3[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl\b[^>]*>|<\/dl>/gi

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities (text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))
      try { return String.fromCodePoint(code) } catch { return m }
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const strip = html => decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()

function attribute (attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs)
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null
}

export function parseBrowserBookmarks (html) {
  const found = new Map()
  const stack = [] // one entry per open <dl>: the folder name that opened it, or null
  let pending = null // a folder heading waiting for its <dl>
  for (const m of html.matchAll(TOKEN)) {
    const [token, heading, attrs, text] = m
    if (heading !== undefined) {
      pending = strip(heading)
    } else if (attrs !== undefined) {
      const url = normaliseUrl(attribute(attrs, 'href') ?? '')
      if (!url || found.has(url)) continue
      const tags = stack.filter(f => f && !CONTAINERS.test(f)).map(f => f.toLowerCase())
      found.set(url, { url, title: strip(text) || null, tags: [...new Set(tags)] })
    } else if (token[1] === '/') {
      stack.pop()
    } else {
      stack.push(pending)
      pending = null
    }
  }
  return [...found.values()]
}

export default parseBrowserBookmarks
