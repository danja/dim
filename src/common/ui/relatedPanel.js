import { esc } from '../http/respond.js'

/** "Related": its topics, and what is like it anywhere in DIM (src/common/related). */
export function renderRelated (related) {
  const items = related?.items ?? []
  const topics = related?.topics ?? []
  if (!items.length && !topics.length) return ''
  const topicLine = topics.length ? `<p class="meta">Topics: ${topics.map(t => `<a href="/topics/${encodeURIComponent(t.slug)}">${esc(t.label)}</a>`).join(', ')}</p>` : ''
  const li = items.map(i => `<li><a href="${esc(i.href)}">${esc(i.label)}</a> <small class="meta">${esc(i.facetLabel ?? '')}</small></li>`).join('')
  return `<section class="related-panel" aria-labelledby="related-h"><h2 id="related-h">Related</h2>${topicLine}${li ? `<ul>${li}</ul>` : ''}</section>`
}
