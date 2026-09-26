import { esc } from '../../common/http/respond.js'
import { bookmarkDataUrl } from './bookmarkData.js'

/** Server-rendered bookmark search page. */

function renderResult (r) {
  const data = bookmarkDataUrl(r)
  return `<li><a href="${esc(r.url)}">${esc(r.name)}</a>${data ? ` <a href="${esc(data)}">data</a>` : ''} <small>${esc(r.domain ?? '')} · ${esc((r.bookmarkTypes || []).join(', '))} · ${typeof r.score === 'number' ? r.score.toFixed(3) : ''}</small>${r.description ? `<br><small>${esc(r.description.slice(0, 200))}</small>` : ''}${r.summary ? `<br><small>${esc(r.summary.slice(0, 200))}</small>` : ''}${(r.keywords ?? []).length ? `<br><small>key terms: ${esc(r.keywords.join(', '))}</small>` : ''}</li>`
}

export function renderSearchPage ({ query, results, total, corpus, elapsedMs, facetValues }) {
  const items = results.map(renderResult).join('\n')
  const typeOpts = (facetValues.bookmarkType ?? []).slice(0, 30).map(f => `<option value="${esc(f.value)}">${esc(f.value)} (${f.count})</option>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>DIM${query ? ' — ' + esc(query) : ''}</title></head><body>
<h1>DIM — Danny's Information Manager</h1>
<form method="get" action="/"><input name="q" value="${esc(query ?? '')}" size="60" placeholder="search bookmarks…">
<select name="bookmarkType"><option value="">all types</option>${typeOpts}</select>
<button>Search</button></form>
<p>${total} of ${corpus} bookmarks${elapsedMs != null ? `, ${elapsedMs}ms` : ''}</p>
<ul>${items}</ul>
<p><a href="/facets">facets</a> · <a href="/health">health</a></p>
</body></html>`
}
