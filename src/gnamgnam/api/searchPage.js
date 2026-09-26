import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { BASE_PATH, bookmarkDataUrl, bookmarkSlug } from './bookmarkData.js'
import { statusBadge } from './bookmarkPage.js'

/** Server-rendered bookmark search page, inside the shared shell. */

function renderResult (r) {
  const data = bookmarkDataUrl(r)
  const slug = bookmarkSlug(r.iri)
  const meta = [
    esc(r.domain ?? ''),
    esc((r.bookmarkTypes || []).join(', ')),
    typeof r.score === 'number' ? r.score.toFixed(3) : '',
    slug ? `<a href="${BASE_PATH}/bookmark/${esc(slug)}">details</a>` : '',
    data ? `<a href="${esc(data)}">data</a>` : ''
  ].filter(Boolean).join(' · ')
  const flag = ['dead', 'blocked', 'error'].includes(r.linkStatus) ? ` ${statusBadge(r.linkStatus)}` : ''
  const text = r.summary || r.description
  return `<li class="card">
<h2><a href="${esc(r.url)}">${esc(r.name)}</a>${flag}</h2>
<p class="meta">${meta}</p>${text ? `\n<p>${esc(text.slice(0, 240))}</p>` : ''}${(r.keywords ?? []).length ? `\n<p class="meta">key terms: ${esc(r.keywords.join(', '))}</p>` : ''}
</li>`
}

function renderOptions (values, selected) {
  return (values ?? []).slice(0, 30).map(f => {
    const sel = f.value === selected ? ' selected' : ''
    return `<option value="${esc(f.value)}"${sel}>${esc(f.value)} (${f.count})</option>`
  }).join('')
}

export function renderSearchPage ({ query, selected = {}, results, total, corpus, elapsedMs, facetValues, tabs, session = null }) {
  const status = elapsedMs != null
    ? `${total} of ${corpus} bookmarks, ${elapsedMs}ms`
    : `${corpus} bookmarks`
  const body = `<h1>Bookmarks</h1>
<form class="search" method="get" action="${BASE_PATH}/" role="search">
<input type="search" name="q" value="${esc(query ?? '')}" placeholder="search bookmarks…" aria-label="Search bookmarks">
<select name="bookmarkType" aria-label="Bookmark type"><option value="">all types</option>${renderOptions(facetValues.bookmarkType, selected.bookmarkType)}</select>
<select name="linkStatus" aria-label="Link status"><option value="">any link status</option>${renderOptions(facetValues.linkStatus, selected.linkStatus)}</select>${selected.domain ? `\n<input type="hidden" name="domain" value="${esc(selected.domain)}">` : ''}
<button>Search</button>
</form>
<p class="status muted">${status}</p>
<ul class="results">
${results.map(renderResult).join('\n')}
</ul>
<p class="foot meta"><a href="${BASE_PATH}/facets">facets</a> · <a href="/health">health</a></p>`
  return renderPage({ title: query ? `${query} — Bookmarks` : 'Bookmarks', tabs, active: 'gnamgnam', body, session })
}
