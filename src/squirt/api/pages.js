import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { formFields, safeReturn } from '../../common/http/write.js'
import { nextCard } from '../../advisor/api/page.js'

/** Squirt: search, capture, and what happened lately — for the phone. */

const KIND_LABELS = [['auto', 'Guess'], ['bookmark', 'Bookmark'], ['task', 'Task'], ['note', 'Note']]

function squirtPage ({ title, body, tabs, session }) {
  return renderPage({ title, tabs, active: 'squirt', session, body, head: '<link rel="stylesheet" href="/static/css/squirt.css">\n<link rel="stylesheet" href="/static/css/advisor.css">' })
}

const searchForm = `<form class="search squirt-search" method="get" action="/find" role="search">
<input type="search" name="q" placeholder="Search everything…" aria-label="Search everything" enterkeyhint="search">
<button>Find</button>
</form>`

export function captureForm ({ session, values = {}, guess = null }) {
  if (!session?.user) {
    return session?.writesEnabled
      ? `<p><a class="button" href="/login?return=${encodeURIComponent(values.returnPath ?? '/squirt/')}">Log in to capture</a></p>`
      : '<p class="muted">Capture needs <code>DIM_WRITE_TOKEN</code> set on the server.</p>'
  }
  const kind = values.kind ?? 'auto'
  const radios = KIND_LABELS.map(([v, label]) => `<label><input type="radio" name="kind" value="${v}"${kind === v ? ' checked' : ''}> ${label}</label>`).join('')
  return `<form id="capture" class="edit capture" method="post" action="/squirt/capture">${formFields(session, '')}
<label for="capture-text">Capture</label>
<textarea id="capture-text" name="text" rows="4" placeholder="A URL → bookmark · “todo …” → task · anything else → a note in the wiki Inbox">${esc(values.text ?? '')}</textarea>
${values.url ? `<input type="hidden" name="url" value="${esc(values.url)}"><p class="meta">Link: <a href="${esc(values.url)}" rel="noopener noreferrer">${esc(values.url)}</a></p>` : ''}
${values.title ? `<input type="hidden" name="title" value="${esc(values.title)}">` : ''}
<fieldset class="kinds"><legend>Save as</legend>${radios}</fieldset>
${guess ? `<p class="meta">Guess: <strong>${esc(guess)}</strong></p>` : ''}
<button>Save</button>
</form>`
}

const ICONS = Object.freeze({ gnamgnam: '🔖', trestle: '•', farelo: '☐', wiki: '¶', news: '📰', blog: '✎' })

function timeline (items) {
  if (!items.length) return '<p class="muted">Nothing yet.</p>'
  return `<ol class="timeline">${items.map(i => `<li>
<span class="facet-icon" aria-hidden="true">${ICONS[i.facet] ?? '·'}</span>
<div><a href="${esc(i.href)}">${esc(i.label)}</a>
<p class="meta">${esc(i.facetLabel ?? '')} · ${esc(i.action ?? '')} <time datetime="${esc(i.at)}">${esc(String(i.at).slice(0, 16).replace('T', ' '))}</time>${i.summary ? ` · ${esc(i.summary)}` : ''}</p></div>
</li>`).join('')}</ol>`
}

function extras (origin) {
  const bookmarklet = `javascript:location.href='${origin}/squirt/share?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+'&text='+encodeURIComponent(getSelection().toString())`
  return `<details class="install"><summary>On your phone, and from any page</summary>
<p><strong>Install:</strong> open this page on your phone and choose <em>Install app</em> / <em>Add to Home Screen</em>. Then <em>Share → DIM</em> from any app sends the link here. Installing needs https (or localhost); see <code>docs/commands-squirt.md</code>.</p>
<p><strong>Bookmarklet:</strong> drag this to your bookmarks bar: <a class="bookmarklet" href="${esc(bookmarklet)}">Squirt to DIM</a></p>
</details>`
}

export function renderHome ({ items, next = null, captured, origin, tabs, session }) {
  const done = safeReturn(captured?.href, null) ? `<p role="status" class="captured">Saved: <a href="${esc(captured.href)}">${esc(captured.label || captured.href)}</a></p>` : ''
  const body = `<h1 class="visually-hidden">Squirt</h1>
${searchForm}
${done}
${captureForm({ session })}
${nextCard(next)}
${session?.user ? `<h2>Lately</h2>\n${timeline(items)}` : ''}
${extras(origin)}`
  return squirtPage({ title: 'Squirt', body, tabs, session })
}

export function renderShare ({ values, guess, tabs, session }) {
  const body = `<h1>Save to DIM</h1>
${values.title ? `<p><strong>${esc(values.title)}</strong></p>` : ''}
${captureForm({ session, values, guess })}`
  return squirtPage({ title: 'Save to DIM', body, tabs, session })
}

export function renderOffline ({ tabs }) {
  return squirtPage({ title: 'Offline', body: '<h1>Offline</h1>\n<p>This page hasn’t been opened on this device yet, so there is no copy to show. Pages you have opened before are available offline.</p>\n<p><a href="/squirt/">Squirt</a></p>', tabs, session: null })
}
