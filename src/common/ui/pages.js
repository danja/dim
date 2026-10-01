import { esc } from '../http/respond.js'
import { renderPage } from './layout.js'

/** Shared pages: log in, and search across facets. */

export function renderLoginPage ({ tabs, session, returnPath = '/', error = null, privateReads = false }) {
  const body = session?.writesEnabled
    ? `<h1>Log in</h1>
${error ? `<p class="status" role="alert">${esc(error)}</p>` : ''}
<form class="edit" method="post" action="/login">
<input type="hidden" name="_return" value="${esc(returnPath)}">
<label for="token">Write token (DIM_WRITE_TOKEN in .env)</label>
<input type="password" id="token" name="token" required autocomplete="current-password">
<button>Log in</button>
</form>
${privateReads
  ? '<p class="meta">This DIM is private (<code>DIM_PRIVATE</code>): every page needs a login. Remove it from <code>.env</code> to let anyone read.</p>'
  : `<p><a class="button secondary" href="${esc(returnPath)}">Ignore — continue read-only</a></p>
<p class="meta">Reading needs no login. Logging in lets this browser edit notes, tags, tasks and links.</p>`}`
    : `<h1>Log in</h1>
<p>Writing is switched off. Set <code>DIM_WRITE_TOKEN</code> in <code>.env</code> (16+ characters) and restart the server.</p>`
  return renderPage({ title: 'Log in', tabs, active: null, session, body })
}

const BY = { both: 'words and meaning', meaning: 'similar meaning', words: 'matching words' }

/** Everything, one ranked list (src/common/search/everything.js), with a facet filter. */
export function renderFindPage ({ tabs, session, query, facet = null, results = [], facets = [], semanticError = null }) {
  const q = encodeURIComponent(query ?? '')
  const total = facets.reduce((n, f) => n + f.count, 0)
  const filter = facets.length > 1
    ? `<nav class="views find-facets" aria-label="Where">${[{ facet: null, label: 'All', count: total }, ...facets].map(f =>
      `<a href="/find?q=${q}${f.facet ? `&amp;facet=${encodeURIComponent(f.facet)}` : ''}"${(facet ?? null) === f.facet ? ' aria-current="page"' : ''}>${esc(f.label)} <span class="count">${f.count}</span></a>`).join('')}</nav>`
    : ''
  const list = results.map(r => `<li class="card"><h2><a href="${esc(r.href)}">${esc(r.label)}</a></h2>
<p class="meta">${esc(r.facetLabel)} · ${BY[r.by]}${r.snippet ? ` — ${esc(r.snippet)}` : ''}</p></li>`).join('\n')
  const status = !query ? '' : results.length ? '' : '<p class="muted">Nothing found.</p>'
  const body = `<h1>Find</h1>
<form class="search" method="get" action="/find" role="search">
<input type="search" name="q" value="${esc(query ?? '')}" placeholder="search everything…" aria-label="Search everything" enterkeyhint="search">
<button>Find</button>
</form>
${semanticError && query ? `<p class="meta" role="status">Searching by words only: ${esc(semanticError)}.</p>` : ''}
${filter}
${status}
${list ? `<ol class="results">${list}</ol>` : ''}`
  return renderPage({ title: query ? `${query} — Find` : 'Find', tabs, active: null, session, body })
}

/** Every tag in use, across facets, biggest first. */
export function renderTagsPage ({ tags, tabs, session }) {
  const items = tags.map(t => `<li><a href="/tags/${encodeURIComponent(t.tag)}">${esc(t.tag)}</a> <small class="meta">${t.count} · ${esc(t.facets.join(', '))}</small></li>`).join('')
  const body = `<h1>Tags</h1>
<p class="meta">Tags on bookmarks, tasks, wiki pages, feeds and published posts, and #hashtags written in notes, pages, tasks, outlines and posts. Pick one to see everything that has it. See also <a href="/topics">topics</a>.</p>
${items ? `<ul class="tag-cloud">${items}</ul>` : '<p class="muted">No tags yet.</p>'}`
  return renderPage({ title: 'Tags', tabs, active: null, session, body })
}

const tagLink = t => `<a href="/tags/${encodeURIComponent(t)}">#${esc(t)}</a>`

/** #a/b is under #a: the tag above and the tags below, as SKOS broader/narrower. */
function tagFamily ({ broader, narrower }) {
  const parts = []
  if (broader) parts.push(`Under ${tagLink(broader)}`)
  if (narrower.length) parts.push(`Narrower: ${narrower.map(tagLink).join(', ')}`)
  return parts.length ? `<p class="meta">${parts.join(' · ')}</p>` : ''
}

/** Everything with one tag, grouped by facet. */
export function renderTagPage ({ tag, groups, topic = null, family = { broader: null, narrower: [] }, tabs, session }) {
  const sections = groups.map(g => `<section>
<h2>${esc(g.label)}</h2>
<ul class="results">${g.results.map(r => `<li class="card"><h3><a href="${esc(r.href)}">${esc(r.label)}</a></h3>${r.snippet ? `<p class="meta">${esc(r.snippet)}</p>` : ''}</li>`).join('')}</ul>
</section>`).join('\n')
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/tags">Tags</a></nav>
<h1>Tagged “${esc(tag)}”</h1>
${tagFamily(family)}
${topic ? `<p class="meta">Also a topic: <a href="/topics/${encodeURIComponent(topic.slug)}">${esc(topic.label)}</a></p>` : ''}
${sections || '<p class="muted">Nothing has this tag.</p>'}
<p class="meta"><a href="/find?q=${encodeURIComponent(tag)}">Search everything for “${esc(tag)}”</a></p>`
  return renderPage({ title: `Tagged ${tag}`, tabs, active: null, session, body })
}
