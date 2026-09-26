import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { CATALOGUE_FIELDS } from '../Catalogue.js'
import { BASE_PATH, bookmarkSlug } from './bookmarkData.js'

/** One bookmark, as an HTML page inside the shared shell. */

const STATUS_TEXT = Object.freeze({
  ok: 'reachable',
  dead: 'dead link',
  blocked: 'site refused the check',
  error: 'error when checked',
  unchecked: 'not checked yet'
})

export function statusBadge (status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUS_TEXT[status] ?? status)}</span>`
}

function renderCatalogue (catalogue = {}) {
  const rows = CATALOGUE_FIELDS
    .filter(field => catalogue[field.key] !== undefined)
    .map(field => {
      const value = catalogue[field.key]
      const text = Array.isArray(value) ? value.join(', ') : String(value)
      return `<dt>${esc(field.label)}</dt><dd>${esc(text)}</dd>`
    })
  return rows.length ? `<h2>Catalogue</h2>\n<dl class="facts">${rows.join('')}</dl>` : ''
}

function renderLinkStatus (doc) {
  const code = doc.fetchStatus ?? doc.httpStatus
  const parts = [statusBadge(doc.linkStatus)]
  if (code) parts.push(`<span class="meta">HTTP ${esc(code)}</span>`)
  if (doc.archivedAt) parts.push(`<a href="${esc(doc.archivedAt)}">archived copy</a>`)
  return `<p class="status">${parts.join(' ')}</p>`
}

function renderOutline (doc) {
  if (!doc.context && doc.sourceLine == null) return ''
  const where = doc.sourceLine != null ? `<dt>Source</dt><dd><code>data/workflowy.md</code> line ${esc(doc.sourceLine)}</dd>` : ''
  const context = doc.context ? `<dt>Context</dt><dd>${esc(doc.context)}</dd>` : ''
  return `<h2>In the outline</h2>\n<dl class="facts">${context}${where}</dl>`
}

export function renderBookmarkPage (doc, { tabs }) {
  const slug = bookmarkSlug(doc.iri)
  const text = doc.summary || doc.description
  const facts = [
    doc.domain ? `<a href="${BASE_PATH}/?domain=${encodeURIComponent(doc.domain)}">${esc(doc.domain)}</a>` : null,
    ...(doc.bookmarkTypes ?? []).map(t => `<a href="${BASE_PATH}/?bookmarkType=${encodeURIComponent(t)}">${esc(t)}</a>`)
  ].filter(Boolean).join(' · ')
  const body = `<p class="meta"><a href="${BASE_PATH}/">← Bookmarks</a></p>
<h1>${esc(doc.name)}</h1>
<p class="url"><a href="${esc(doc.url)}">${esc(doc.url)}</a></p>
${renderLinkStatus(doc)}
${facts ? `<p class="meta">${facts}</p>` : ''}
${text ? `<p>${esc(text)}</p>` : '<p class="muted">No summary yet.</p>'}
${(doc.keywords ?? []).length ? `<p class="meta">key terms: ${esc(doc.keywords.join(', '))}</p>` : ''}
${renderCatalogue(doc.catalogue)}
${renderOutline(doc)}
<p class="foot meta">data: <a href="${BASE_PATH}/bookmark/${esc(slug)}.ttl">Turtle</a> · <a href="${BASE_PATH}/bookmark/${esc(slug)}.json">JSON</a></p>`
  return renderPage({ title: doc.name, tabs, active: 'gnamgnam', body })
}

export default renderBookmarkPage
