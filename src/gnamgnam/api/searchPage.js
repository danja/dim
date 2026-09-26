import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { BASE_PATH, bookmarkDataUrl } from './bookmarkData.js'

/** Server-rendered bookmark search page, inside the shared shell. */

function renderResult (r) {
  const data = bookmarkDataUrl(r)
  const meta = [
    esc(r.domain ?? ''),
    esc((r.bookmarkTypes || []).join(', ')),
    typeof r.score === 'number' ? r.score.toFixed(3) : '',
    data ? `<a href="${esc(data)}">data</a>` : ''
  ].filter(Boolean).join(' · ')
  const text = r.summary || r.description
  return `<li class="card">
<h2><a href="${esc(r.url)}">${esc(r.name)}</a></h2>
<p class="meta">${meta}</p>${text ? `\n<p>${esc(text.slice(0, 240))}</p>` : ''}${(r.keywords ?? []).length ? `\n<p class="meta">key terms: ${esc(r.keywords.join(', '))}</p>` : ''}
</li>`
}

function renderTypeOptions (facetValues, selected) {
  return (facetValues.bookmarkType ?? []).slice(0, 30).map(f => {
    const sel = f.value === selected ? ' selected' : ''
    return `<option value="${esc(f.value)}"${sel}>${esc(f.value)} (${f.count})</option>`
  }).join('')
}

export function renderSearchPage ({ query, bookmarkType = null, results, total, corpus, elapsedMs, facetValues, tabs }) {
  const status = elapsedMs != null
    ? `${total} of ${corpus} bookmarks, ${elapsedMs}ms`
    : `${corpus} bookmarks`
  const body = `<h1>Bookmarks</h1>
<form class="search" method="get" action="${BASE_PATH}/" role="search">
<input type="search" name="q" value="${esc(query ?? '')}" placeholder="search bookmarks…" aria-label="Search bookmarks">
<select name="bookmarkType" aria-label="Bookmark type"><option value="">all types</option>${renderTypeOptions(facetValues, bookmarkType)}</select>
<button>Search</button>
</form>
<p class="status muted">${status}</p>
<ul class="results">
${results.map(renderResult).join('\n')}
</ul>
<p class="foot meta"><a href="${BASE_PATH}/facets">facets</a> · <a href="/health">health</a></p>`
  return renderPage({ title: query ? `${query} — Bookmarks` : 'Bookmarks', tabs, active: 'gnamgnam', body })
}
