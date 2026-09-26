import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { renderMarkdown } from '../../common/ui/markdown.js'
import { LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'
import { slugForTitle } from '../rdf.js'

/** Shared bits of the wiki pages. */

export const pagePath = page => `/wiki/page/${page.slug}`

/** Where [[Title]] goes: the page of that title, or a new page to create. */
export function titleLinker (pages) {
  const byTitle = new Map(pages.map(p => [p.title.toLowerCase(), p.slug]))
  return title => {
    const slug = byTitle.get(title.toLowerCase())
    return slug ? `/wiki/page/${slug}` : `/wiki/page/${slugForTitle(title)}?title=${encodeURIComponent(title)}`
  }
}

export function contentHtml (content, pages) {
  return `<div class="wiki-content">${renderMarkdown(content, { titleHref: titleLinker(pages) })}</div>`
}

export function wikiPage ({ title, body, tabs, session }) {
  const head = `<link rel="stylesheet" href="/static/css/wiki.css">${session?.user ? `\n${LINK_PICKER_SCRIPT}` : ''}`
  return renderPage({ title, tabs, active: 'wiki', session, body, head })
}

export function when (iso) {
  return iso ? `<time datetime="${esc(iso)}">${esc(String(iso).slice(0, 16).replace('T', ' '))}</time>` : ''
}

/** A diff as a list, long unchanged runs folded to a few lines of context. */
export function renderDiff (diff, { context = 3 } = {}) {
  if (!diff) return '<p class="muted">Too large to compare line by line.</p>'
  const show = diff.map((d, i) => d.op !== ' ' || diff.slice(Math.max(0, i - context), i + context + 1).some(n => n.op !== ' '))
  if (!show.includes(true)) return '<p class="muted">No differences.</p>'
  const rows = []
  let skipped = 0
  diff.forEach((d, i) => {
    if (!show[i]) { skipped++; return }
    if (skipped) rows.push(`<li class="fold">… ${skipped} unchanged line${skipped === 1 ? '' : 's'}</li>`)
    skipped = 0
    const cls = d.op === '+' ? 'ins' : d.op === '-' ? 'del' : 'same'
    const label = d.op === '+' ? '<span class="visually-hidden">added: </span>' : d.op === '-' ? '<span class="visually-hidden">removed: </span>' : ''
    rows.push(`<li class="${cls}">${label}${esc(d.line) || ' '}</li>`)
  })
  if (skipped) rows.push(`<li class="fold">… ${skipped} unchanged line${skipped === 1 ? '' : 's'}</li>`)
  return `<ol class="diff">${rows.join('')}</ol>`
}
