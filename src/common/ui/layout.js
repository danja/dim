import { esc } from '../http/respond.js'

/**
 * The HTML shell every facet page is rendered into: viewport meta, shared
 * stylesheet, and the tab row linking all facets. Mobile-first; the tab
 * row scrolls sideways on narrow screens.
 */

export const SITE_NAME = 'DIM'

export function renderTabs (tabs, active) {
  const items = tabs.map(tab => {
    const current = tab.id === active ? ' aria-current="page"' : ''
    return `<li><a href="${esc(tab.href)}"${current}>${esc(tab.label)}</a></li>`
  }).join('')
  return `<nav class="tabs" aria-label="Facets"><ul>${items}</ul></nav>`
}

/** Log in / log out, when writes are enabled at all. */
export function renderSession (session) {
  if (!session?.writesEnabled) return ''
  if (session.user) {
    return `<form class="session" method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(session.csrf ?? '')}"><button class="linkish">log out</button></form>`
  }
  return '<a class="session" href="/login">log in</a>'
}

/**
 * A full page. body is trusted HTML built by the caller with esc();
 * title is plain text. session (optional) is the request's identity:
 * { user, csrf, writesEnabled }.
 */
export function renderPage ({ title, tabs, active, body, head = '', session = null }) {
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(fullTitle)}</title>
<link rel="stylesheet" href="/static/css/base.css">
<link rel="manifest" href="/squirt/manifest.webmanifest">
<meta name="theme-color" content="#2b5fae">
<link rel="icon" href="/static/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
${session?.user && session.csrf ? `<meta name="csrf-token" content="${esc(session.csrf)}">` : ''}
<script type="module" src="/static/js/tabs.js"></script>
${head}
</head>
<body>
<header class="site">
${renderTabs(tabs, active)}
${renderSession(session)}
</header>
<main id="main">
${body}
</main>
</body>
</html>`
}

export default renderPage
