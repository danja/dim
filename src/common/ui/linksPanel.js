import { esc } from '../http/respond.js'
import { LINK_KINDS, USER_LINK_KINDS } from '../links/LinkStore.js'
import { formFields } from '../http/write.js'

/**
 * "Links" section for any detail page: outgoing and incoming links grouped
 * by kind, a remove button on each hand-made link, and a form (with a
 * type-ahead picker, /static/js/linkpicker.js) to add one.
 *
 * links: [{ kind, direction, iri, label, href, facetLabel }] (resolved)
 */

export const LINK_PICKER_SCRIPT = '<script type="module" src="/static/js/linkpicker.js"></script>'

function removeForm ({ link, subject, session, returnPath }) {
  if (!session?.user || link.kind === 'mentions') return ''
  const [from, to] = link.direction === 'out' ? [subject, link.iri] : [link.iri, subject]
  return `<form class="inline" method="post" action="/links/delete">${formFields(session, returnPath)}<input type="hidden" name="from" value="${esc(from)}"><input type="hidden" name="to" value="${esc(to)}"><input type="hidden" name="kind" value="${esc(link.kind)}"><button aria-label="Remove link to ${esc(link.label)}">remove</button></form>`
}

function item (link, ctx) {
  const where = link.facetLabel ? ` <small class="meta">${esc(link.facetLabel)}</small>` : ''
  const text = link.href ? `<a href="${esc(link.href)}">${esc(link.label)}</a>` : `<span>${esc(link.label)}</span>`
  return `<li>${text}${where}${removeForm({ link, ...ctx })}</li>`
}

function addForm ({ subject, session, returnPath }) {
  if (!session?.writesEnabled) return ''
  if (!session.user) return '<p class="meta"><a href="/login">Log in</a> to add links.</p>'
  const options = USER_LINK_KINDS.map(kind => `<option value="${kind}">${esc(LINK_KINDS[kind].label.toLowerCase())}</option>`).join('')
  return `<form class="add-link" method="post" action="/links">${formFields(session, returnPath)}<input type="hidden" name="from" value="${esc(subject)}">
<select name="kind" aria-label="Kind of link">${options}</select>
<input type="text" name="to" data-picker required autocomplete="off" placeholder="search, or paste a URL / [[type/slug]]" aria-label="Link to">
<button>Link</button>
</form>`
}

export function renderLinksPanel (links, { subject, session, returnPath }) {
  const groups = new Map()
  for (const link of links) {
    const spec = LINK_KINDS[link.kind]
    const heading = link.direction === 'out' ? spec.label : spec.inverse
    if (!groups.has(heading)) groups.set(heading, [])
    groups.get(heading).push(link)
  }
  const ctx = { subject, session, returnPath }
  const lists = [...groups].map(([heading, items]) =>
    `<h3>${esc(heading)}</h3>\n<ul>${items.map(l => item(l, ctx)).join('')}</ul>`).join('\n')
  const empty = links.length ? '' : '<p class="muted">No links yet.</p>'
  return `<section class="links" aria-labelledby="links-h">
<h2 id="links-h">Links</h2>
${lists}${empty}
${addForm(ctx)}
</section>`
}
