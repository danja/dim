import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { renderMarkdown } from '../../common/ui/markdown.js'
import { renderLinksPanel, LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'
import { formFields } from '../../common/http/write.js'
import { plainText } from '../../common/outline/OutlineParser.js'
import { renderTree, titleHtml, nodePath } from './treeView.js'
import { renderRelated } from '../../common/ui/relatedPanel.js'

/** Trestle pages: the list of outlines, an outline, one node zoomed in. */

const OUTLINER_SCRIPT = '<script type="module" src="/static/js/outliner.js"></script>'
export const outlinePath = outline => `/trestle/outline/${outline.slug}`

function page ({ title, body, tabs, session, head = '' }) {
  const scripts = session?.user ? `${OUTLINER_SCRIPT}\n${LINK_PICKER_SCRIPT}` : ''
  return renderPage({ title, tabs, active: 'trestle', session, body, head: `${scripts}${head}` })
}

export function renderIndex ({ outlines, tabs, session }) {
  const items = outlines.map(o => `<li class="card"><h2><a href="${outlinePath(o)}">${esc(o.title)}</a></h2><p class="meta">${o.nodes.size} items · <a href="${outlinePath(o)}.md">Markdown</a></p></li>`).join('')
  const create = session?.user
    ? `<form class="search" method="post" action="/trestle/outlines">${formFields(session, '')}
<input type="text" name="title" required placeholder="New outline title" aria-label="New outline title">
<button>Create</button>
</form>`
    : ''
  const body = `<h1>Outlines</h1>
${create}
${items ? `<ul class="results">${items}</ul>` : '<p class="muted">No outlines yet. Import one with <code>node bin/trestle-import.js</code>.</p>'}`
  return page({ title: 'Outlines', body, tabs, session })
}

function addForm ({ outline, parentId, session, returnPath, label }) {
  if (!session?.user) return ''
  return `<form class="add-node" method="post" action="/trestle/nodes">${formFields(session, returnPath)}
<input type="hidden" name="outline" value="${esc(outline.slug)}"><input type="hidden" name="parent" value="${esc(parentId ?? '')}">
<input type="text" name="title" required placeholder="${esc(label)}" aria-label="${esc(label)}" autocomplete="off">
<button>Add</button>
</form>`
}

const KEYS_HELP = `<details class="keys"><summary>Keyboard</summary>
<p class="meta">Click a title to edit it. <kbd>Enter</kbd> new item · <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> indent / outdent · <kbd>↑</kbd> <kbd>↓</kbd> move between items · <kbd>Alt</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> move the item · <kbd>Backspace</kbd> on an empty item deletes it · <kbd>Esc</kbd> stop editing.</p>
</details>`

export function renderOutlinePage ({ outline, tabs, session, treeCtx }) {
  const returnPath = outlinePath(outline)
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/trestle/">Outlines</a></nav>
<h1>${esc(outline.title)}</h1>
${session?.user ? KEYS_HELP : ''}
${renderTree(outline, outline.iri, { ...treeCtx, session, returnPath })}
${addForm({ outline, parentId: null, session, returnPath, label: 'New top-level item' })}
<p class="foot meta">${outline.nodes.size} items · export: <a href="${returnPath}.md">Markdown</a> · <a href="${returnPath}.ttl">Turtle</a></p>`
  return page({ title: outline.title, body, tabs, session })
}

function nodeActions ({ node, session, returnPath, parentPath }) {
  if (!session?.user) return ''
  const moves = [['up', '↑ up'], ['down', '↓ down'], ['outdent', '⇤ outdent'], ['indent', '⇥ indent']]
    .map(([op, text]) => `<button name="op" value="${op}">${text}</button>`).join('')
  return `<div class="node-actions">
<form class="inline-buttons" method="post" action="${nodePath(node)}/move">${formFields(session, returnPath)}${moves}</form>
<form class="inline-buttons" method="post" action="/blog/posts">${formFields(session, '')}<input type="hidden" name="from" value="${esc(node.iri)}"><button>Draft a blog post</button></form>
<form class="inline-buttons" method="post" action="${nodePath(node)}/delete" data-confirm="Delete this item and everything under it?">${formFields(session, parentPath)}<button class="danger">Delete</button></form>
</div>`
}

function editForm ({ node, session, returnPath }) {
  if (!session?.user) return ''
  return `<details><summary>Edit title and note</summary>
<form class="edit" method="post" action="${nodePath(node)}">${formFields(session, returnPath)}
<label for="node-title">Title (Markdown)</label>
<input type="text" id="node-title" name="title" value="${esc(node.title)}">
<label for="node-note">Note (Markdown; [[type/slug]] or [[Title]] links to things)</label>
<textarea id="node-note" name="note">${esc(node.note ?? '')}</textarea>
<button>Save</button>
</form>
</details>`
}

export function renderNodePage ({ outline, node, crumbs, tabs, session, treeCtx, links, related = null }) {
  const returnPath = nodePath(node)
  const parent = crumbs.at(-1)
  const parentPath = parent ? nodePath(parent) : outlinePath(outline)
  const trail = ['<a href="/trestle/">Outlines</a>', `<a href="${outlinePath(outline)}">${esc(outline.title)}</a>`,
    ...crumbs.map(c => `<a href="${nodePath(c)}">${esc(plainText(c.title) || '(untitled)')}</a>`)].join(' <span aria-hidden="true">›</span> ')
  const linksHtml = renderLinksPanel(links, { subject: node.iri, session, returnPath })
  const body = `<nav class="crumbs" aria-label="Breadcrumbs">${trail}</nav>
<h1 class="node-title">${titleHtml(node)}</h1>
${node.note ? `<div class="note">${renderMarkdown(node.note)}</div>` : ''}
${nodeActions({ node, session, returnPath, parentPath })}
${editForm({ node, session, returnPath })}
${renderTree(outline, node.iri, { ...treeCtx, session, returnPath })}
${addForm({ outline, parentId: node.id, session, returnPath, label: 'New item here' })}
${renderRelated(related)}
${linksHtml}
<p class="foot meta">export: <a href="${returnPath}.md">Markdown</a> · <a href="${returnPath}.json">JSON</a></p>`
  return page({ title: plainText(node.title) || '(untitled)', body, tabs, session })
}
