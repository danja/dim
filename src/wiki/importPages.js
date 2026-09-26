import { slugForTitle } from './rdf.js'

/**
 * Pages to import, from a foowiki Turtle dump or a folder of Markdown files.
 * Pure functions; bin/wiki-import.js does the reading and writing.
 *
 * Links between pages become wiki links: foowiki's relative
 * `[text](Page Title)` and a Markdown file's `[text](other.md)` turn into
 * `[[Page Title]]` (same text) or `[text](/r/page/<slug>)`, so they are
 * followed, and recorded as mentions, like any other.
 */

const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/|#)/i

/**
 * Rewrite the targets of inline links that are not URLs, paths or anchors.
 * titleFor(target) → the page title it means, or null to leave it alone.
 */
export function rewritePageLinks (content, titleFor) {
  return String(content ?? '').split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => i % 2
    ? part
    : part.replace(/(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g, (whole, bang, text, rawTarget) => {
      const target = rawTarget.trim().replace(/^<(.*)>$/, '$1')
      if (bang || EXTERNAL.test(target)) return whole
      let decoded = target
      try { decoded = decodeURIComponent(target) } catch { /* keep raw */ }
      const title = titleFor(decoded)
      if (!title) return whole
      return text.trim() === title ? `[[${title}]]` : `[${text}](/r/page/${slugForTitle(title)})`
    })
  ).join('')
}

// ── foowiki (Turtle) ─────────────────────────────────────────────────

const LOCAL = term => term.value.replace(/^.*[#/]/, '')
const TITLE = new Set(['title', 'label'])
const TAGS = new Set(['tag', 'topic', 'subject', 'keyword'])
const DATES = new Set(['date', 'created', 'modified'])

/** Dataset → [{ title, content, tags, created }] for everything with a title and sioc:content. */
export function pagesFromDataset (dataset) {
  const bySubject = new Map()
  for (const quad of dataset) {
    const key = quad.subject.value
    if (!bySubject.has(key)) bySubject.set(key, { title: null, content: null, tags: [], dates: [] })
    const entry = bySubject.get(key)
    const name = LOCAL(quad.predicate)
    if (quad.object.termType !== 'Literal') continue
    if (name === 'content') entry.content = quad.object.value
    else if (TITLE.has(name) && !entry.title) entry.title = quad.object.value.trim()
    else if (TAGS.has(name)) entry.tags.push(...quad.object.value.split(',').map(t => t.trim()).filter(Boolean))
    else if (DATES.has(name) && !Number.isNaN(Date.parse(quad.object.value))) entry.dates.push(quad.object.value)
  }
  const pages = [...bySubject.values()].filter(p => p.title && p.content !== null)
  const titles = new Map(pages.map(p => [p.title.toLowerCase(), p.title]))
  return pages.map(p => ({
    title: p.title,
    content: rewritePageLinks(p.content, t => titles.get(t.toLowerCase()) ?? null),
    tags: p.tags,
    created: p.dates.sort()[0] ?? null
  }))
}

// ── A folder of Markdown files ───────────────────────────────────────

/** One .md file → { title, content, tags }. Front matter title/tags, else the first # heading, else the file name. */
export function pageFromMarkdown (fileName, text) {
  let body = String(text ?? '').replace(/\r\n/g, '\n')
  let title = null
  let tags = []
  const front = body.match(/^---\n([\s\S]*?)\n---\n?/)
  if (front) {
    body = body.slice(front[0].length)
    for (const line of front[1].split('\n')) {
      const m = line.match(/^(title|tags):\s*(.*)$/i)
      if (!m) continue
      const value = m[2].trim().replace(/^\[(.*)\]$/, '$1').replace(/^["']|["']$/g, '')
      if (m[1].toLowerCase() === 'title') title = value
      else tags = value.split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    }
  }
  if (!title) {
    const heading = body.match(/^\s*# +(.+)\n?/)
    if (heading) {
      title = heading[1].trim()
      body = body.slice(heading[0].length)
    }
  }
  if (!title) title = fileName.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim()
  return { title, content: body.replace(/^\n+/, ''), tags }
}

/** files: [{ name, text }] → pages, with links between the files rewritten. */
export function pagesFromMarkdownFiles (files) {
  const pages = files.map(f => ({ ...pageFromMarkdown(f.name, f.text), name: f.name }))
  const byFile = new Map(pages.map(p => [p.name.toLowerCase(), p.title]))
  const byTitle = new Map(pages.map(p => [p.title.toLowerCase(), p.title]))
  const titleFor = target => byFile.get(target.replace(/^\.\//, '').toLowerCase()) ?? byTitle.get(target.toLowerCase()) ?? null
  return pages.map(({ name, ...p }) => ({ ...p, content: rewritePageLinks(p.content, titleFor), created: null }))
}
