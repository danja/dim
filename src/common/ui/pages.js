import { esc } from '../http/respond.js'
import { renderPage } from './layout.js'

/** Shared pages: log in, and search across facets. */

export function renderLoginPage ({ tabs, session, returnPath = '/', error = null }) {
  const body = session?.writesEnabled
    ? `<h1>Log in</h1>
${error ? `<p class="status" role="alert">${esc(error)}</p>` : ''}
<form class="edit" method="post" action="/login">
<input type="hidden" name="_return" value="${esc(returnPath)}">
<label for="token">Write token (DIM_WRITE_TOKEN in .env)</label>
<input type="password" id="token" name="token" required autocomplete="current-password">
<button>Log in</button>
</form>
<p class="meta">Reading needs no login. Logging in lets this browser edit notes, tags and links.</p>`
    : `<h1>Log in</h1>
<p>Writing is switched off. Set <code>DIM_WRITE_TOKEN</code> in <code>.env</code> (16+ characters) and restart the server.</p>`
  return renderPage({ title: 'Log in', tabs, active: null, session, body })
}

export function renderFindPage ({ tabs, session, query, groups }) {
  const sections = groups.map(g => `<section>
<h2>${esc(g.label)}</h2>${g.error ? `\n<p class="muted">Search unavailable here: ${esc(g.error)}</p>` : ''}
<ul class="results">${g.results.map(r => `<li class="card"><h3><a href="${esc(r.href)}">${esc(r.label)}</a></h3>${r.snippet ? `<p class="meta">${esc(r.snippet)}</p>` : ''}</li>`).join('')}</ul>
</section>`).join('\n')
  const status = query ? (groups.some(g => g.results.length) ? '' : '<p class="muted">Nothing found.</p>') : ''
  const body = `<h1>Find</h1>
<form class="search" method="get" action="/find" role="search">
<input type="search" name="q" value="${esc(query ?? '')}" placeholder="search everything…" aria-label="Search everything">
<button>Find</button>
</form>
${status}
<div class="groups">${sections}</div>`
  return renderPage({ title: query ? `${query} — Find` : 'Find', tabs, active: null, session, body })
}
