import { esc } from '../http/respond.js'

/** "Related": what is like this, anywhere in DIM (src/common/related). */
export function renderRelated (items) {
  if (!items?.length) return ''
  const li = items.map(i => `<li><a href="${esc(i.href)}">${esc(i.label)}</a> <small class="meta">${esc(i.facetLabel ?? '')}</small></li>`).join('')
  return `<section class="related-panel" aria-labelledby="related-h"><h2 id="related-h">Related</h2><ul>${li}</ul></section>`
}
