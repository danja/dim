import { esc } from '../http/respond.js'

/**
 * A note listing links in some text that looked broken when GnamGnam last
 * checked them (src/common/links/urls.js badLinks), with archived copies.
 */
const LABELS = Object.freeze({ dead: 'gone', blocked: 'refused', error: 'error' })

export function renderLinkHealth (bad) {
  if (!bad?.length) return ''
  const items = bad.map(b => `<li><a href="${esc(b.url)}" rel="noopener noreferrer">${esc(b.url)}</a> <small class="meta">${esc(LABELS[b.status] ?? b.status)} · <a href="${esc(b.href)}">bookmark</a>${b.archivedAt ? ` · <a href="${esc(b.archivedAt)}" rel="noopener noreferrer">archived copy</a>` : ''}</small></li>`).join('')
  return `<aside class="link-health" aria-labelledby="link-health-h"><h2 id="link-health-h">Links to check</h2>
<p class="meta">These looked broken when last checked (<code>node bin/deadlinks.js</code>).</p>
<ul>${items}</ul></aside>`
}
