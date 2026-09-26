import { XMLParser } from 'fast-xml-parser'
import { esc } from '../../common/http/respond.js'

/**
 * Subscription lists: OPML in and out, and plain text (one URL per line,
 * # comments — NewsMonitor's feedlists/*.txt). → [{ url, title, tags }]
 */

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: name => name === 'outline', parseAttributeValue: false })

function walk (outlines, tags, out) {
  for (const o of outlines ?? []) {
    const url = o.xmlUrl ?? o.xmlurl ?? o.url
    if (url) {
      const own = String(o.category ?? '').split(/[,/]/).map(t => t.trim().toLowerCase()).filter(Boolean)
      out.push({ url: String(url).trim(), title: String(o.title ?? o.text ?? '').trim() || null, tags: [...new Set([...tags, ...own])] })
    }
    const folder = !url && (o.title ?? o.text) ? [String(o.title ?? o.text).trim().toLowerCase()] : []
    walk(o.outline, [...tags, ...folder], out)
  }
  return out
}

export function parseOpml (xml) {
  let doc
  try {
    doc = parser.parse(String(xml ?? ''))
  } catch (error) {
    throw new Error(`Not well-formed OPML: ${error.message}`)
  }
  if (!doc.opml?.body) throw new Error('Not OPML (no <opml><body>)')
  return walk(doc.opml.body.outline, [], [])
}

export function parseFeedList (text) {
  return String(text ?? '').split('\n')
    .map(line => line.replace(/#.*$/, '').trim())
    .filter(line => /^https?:\/\//i.test(line))
    .map(url => ({ url, title: null, tags: [] }))
}

/** Either format, by sniffing. */
export function parseSubscriptions (text) {
  return /^\s*(<\?xml[^>]*>\s*)?<opml/i.test(String(text ?? '')) ? parseOpml(text) : parseFeedList(text)
}

/** feeds: [{ url, title, siteUrl, tags }] → OPML 2.0, grouped by first tag. */
export function toOpml (feeds, { title = 'DIM news subscriptions', now = new Date() } = {}) {
  const line = f => `<outline type="rss" text="${esc(f.title)}" title="${esc(f.title)}" xmlUrl="${esc(f.url)}"${f.siteUrl ? ` htmlUrl="${esc(f.siteUrl)}"` : ''}${f.tags.length ? ` category="${esc(f.tags.join(','))}"` : ''}/>`
  const groups = new Map()
  for (const f of feeds) {
    const key = f.tags[0] ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  const body = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([tag, fs]) => tag
    ? `    <outline text="${esc(tag)}" title="${esc(tag)}">\n${fs.map(f => `      ${line(f)}`).join('\n')}\n    </outline>`
    : fs.map(f => `    ${line(f)}`).join('\n')).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${esc(title)}</title>
    <dateCreated>${now.toUTCString()}</dateCreated>
  </head>
  <body>
${body}
  </body>
</opml>
`
}
