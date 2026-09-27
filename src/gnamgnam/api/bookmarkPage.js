import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { CATALOGUE_FIELDS } from '../Catalogue.js'
import { renderMarkdown } from '../../common/ui/markdown.js'
import { renderLinksPanel, LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'
import { formFields } from '../../common/http/write.js'
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

function renderTagList (tags, { search = true } = {}) {
  if (!tags?.length) return ''
  return `<ul class="tags">${tags.map(t => search
    ? `<li><a href="${BASE_PATH}/?q=${encodeURIComponent(t)}">${esc(t)}</a></li>`
    : `<li>${esc(t)}</li>`).join('')}</ul>`
}

/** The owner's tags and note, with an edit form when logged in. */
function renderAnnotations (doc, { session, slug }) {
  const path = `${BASE_PATH}/bookmark/${slug}`
  const shown = `${renderTagList(doc.userTags)}${doc.note ? `\n<div class="note">${renderMarkdown(doc.note)}</div>` : ''}`
  const empty = !doc.userTags?.length && !doc.note
  let form = ''
  if (session?.user) {
    form = `<details${empty ? ' open' : ''}><summary>Edit tags and note</summary>
<form class="edit" method="post" action="${path}/annotations">${formFields(session, path)}
<label for="tags">Tags, comma-separated</label>
<input type="text" id="tags" name="tags" value="${esc((doc.userTags ?? []).join(', '))}" autocomplete="off">
<label for="note">Note (Markdown; [[bookmark/slug]] or [[Title]] links to things)</label>
<textarea id="note" name="note">${esc(doc.note ?? '')}</textarea>
<button>Save</button>
</form>
</details>`
  } else if (session?.writesEnabled) {
    form = `<p class="meta"><a href="/login?return=${encodeURIComponent(path)}">Log in</a> to add tags and a note.</p>`
  }
  if (empty && !form) return ''
  return `<section aria-labelledby="yours-h">\n<h2 id="yours-h">Your tags and note</h2>\n${shown}${empty && !session?.user ? '<p class="muted">None yet.</p>' : ''}\n${form}\n</section>`
}

function renderLinks (doc, { links, session, slug }) {
  return renderLinksPanel(links, { subject: doc.iri, session, returnPath: `${BASE_PATH}/bookmark/${slug}` })
}

/**
 * site: { alsoHere: [{ label, href, facetLabel }] (e.g. its feed), offerFeed: origin URL or null }
 * source: where the bookmark came from, resolved ({ label, href, facetLabel }) or null.
 */
function renderSite ({ site, session }) {
  if (!site) return ''
  const here = site.alsoHere.map(a => `<a href="${esc(a.href)}">${esc(a.label)}</a> <small class="meta">${esc(a.facetLabel ?? '')}</small>`).join(', ')
  if (here) return `<p class="meta">From this site: ${here}</p>`
  if (!site.offerFeed || !session?.user) return ''
  return `<form class="inline-buttons" method="post" action="/news/feeds">${formFields(session, '')}<input type="hidden" name="url" value="${esc(site.offerFeed)}"><button>Look for this site's feed</button></form>`
}

export function renderBookmarkPage (doc, { tabs, session = null, links = null, site = null, source = null }) {
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
${source?.href ? `<p class="meta">Saved from <a href="${esc(source.href)}">${esc(source.label)}</a>${source.facetLabel ? ` (${esc(source.facetLabel)})` : ''}</p>` : ''}
${renderSite({ site, session })}
${text ? `<p>${esc(text)}</p>` : '<p class="muted">No summary yet.</p>'}
${(doc.topics ?? []).length ? `<p class="meta">topics: ${doc.topics.map(t => `<a href="${BASE_PATH}/?topic=${encodeURIComponent(t)}">${esc(t)}</a>`).join(', ')}</p>` : ''}
${(doc.keywords ?? []).length ? `<p class="meta">key terms: ${esc(doc.keywords.join(', '))}</p>` : ''}
${renderAnnotations(doc, { session, slug })}
${renderLinks(doc, { links, session, slug })}
${renderCatalogue(doc.catalogue)}
${renderOutline(doc)}
<p class="foot meta">data: <a href="${BASE_PATH}/bookmark/${esc(slug)}.ttl">Turtle</a> · <a href="${BASE_PATH}/bookmark/${esc(slug)}.json">JSON</a></p>`
  const head = session?.user ? LINK_PICKER_SCRIPT : ''
  return renderPage({ title: doc.name, tabs, active: 'gnamgnam', body, session, head })
}

export default renderBookmarkPage
