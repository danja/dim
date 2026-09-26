import { esc } from '../../common/http/respond.js'
import { renderInline } from '../../common/ui/markdown.js'
import { formFields } from '../../common/http/write.js'
import { childrenOf } from '../tree.js'

/**
 * The outline as nested lists, server-rendered. Collapsed nodes show a
 * toggle and hide their children. Works without JavaScript (links zoom,
 * forms toggle); /static/js/outliner.js adds in-place editing.
 */

export const nodePath = node => `/trestle/node/${node.id}`

export function titleHtml (node) {
  return node.title ? renderInline(node.title) : '<span class="muted">(untitled)</span>'
}

function toggle (node, count, { session, returnPath }) {
  if (!count) return '<span class="toggle-space" aria-hidden="true"></span>'
  const label = `${node.collapsed ? 'Expand' : 'Collapse'} (${count})`
  if (!session?.user) {
    return `<a class="toggle" href="${nodePath(node)}" aria-label="Open to see ${count} item${count === 1 ? '' : 's'}">${node.collapsed ? '▸' : '▾'}</a>`
  }
  return `<form class="toggle-form" method="post" action="${nodePath(node)}">${formFields(session, returnPath)}<input type="hidden" name="collapsed" value="${node.collapsed ? 'false' : 'true'}"><button class="toggle" aria-expanded="${!node.collapsed}" aria-label="${esc(label)}">${node.collapsed ? '▸' : '▾'}</button></form>`
}

function resourceLinks (node, { resources, registryHref }) {
  const targets = resources?.get(node.iri) ?? []
  return targets.map(r => {
    const href = registryHref(r)
    return href ? `<a class="res" href="${esc(href)}" title="Bookmark details" aria-label="Bookmark details">⌗</a>` : ''
  }).join('')
}

function renderItem (outline, node, ctx) {
  const kids = childrenOf(outline, node.iri)
  const children = kids.length && !node.collapsed ? renderList(outline, node.iri, ctx) : ''
  return `<li data-id="${esc(node.id)}" data-children="${kids.length}"${node.collapsed ? ' data-collapsed' : ''}>
<div class="row">${toggle(node, kids.length, ctx)}<a class="bullet" href="${nodePath(node)}" aria-label="Open">•</a><span class="title" data-raw="${esc(node.title)}">${titleHtml(node)}</span>${node.note ? '<span class="has-note" title="Has a note">¶</span>' : ''}${resourceLinks(node, ctx)}</div>${children}
</li>`
}

export function renderList (outline, parentIri, ctx) {
  const kids = childrenOf(outline, parentIri)
  if (!kids.length) return ''
  return `<ul>${kids.map(node => renderItem(outline, node, ctx)).join('')}</ul>`
}

/** The whole tree under `parentIri`, wrapped for the outliner script. */
export function renderTree (outline, parentIri, ctx) {
  const inner = renderList(outline, parentIri, ctx)
  const editable = ctx.session?.user ? ' data-editable' : ''
  return `<div class="outline" data-outline="${esc(outline.slug)}" data-parent="${esc(parentIri)}"${editable}>${inner || '<p class="muted empty">Nothing here yet.</p>'}</div>`
}

/** Nodes that will be visible (for fetching their resource links in one go). */
export function visibleNodes (outline, parentIri) {
  const out = []
  for (const node of childrenOf(outline, parentIri)) {
    out.push(node)
    if (!node.collapsed) out.push(...visibleNodes(outline, node.iri))
  }
  return out
}
