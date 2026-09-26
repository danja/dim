import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { pagePath, contentHtml, wikiPage, renderDiff } from './common.js'

/**
 * The edit form, with a server-rendered preview (works without JS) and the
 * conflict page: when someone saved in between, the edit is kept in the
 * form, rebased on the latest revision, with what changed shown alongside.
 *
 * draft: { slug, title, content, tags (string), base }
 */

function form ({ draft, session, cancel }) {
  const action = `/wiki/page/${draft.slug}`
  return `<form class="edit wiki-edit" method="post" action="${esc(action)}">${formFields(session, '')}
<input type="hidden" name="base" value="${esc(String(draft.base))}">
<label for="wiki-title">Title</label>
<input type="text" id="wiki-title" name="title" required maxlength="200" value="${esc(draft.title)}">
<label for="wiki-content">Text (Markdown; <code>[[Page title]]</code> links to a wiki page, <code>[[type/slug]]</code> to anything)</label>
<textarea id="wiki-content" name="content" rows="18">${esc(draft.content)}</textarea>
<label for="wiki-tags">Tags (comma-separated)</label>
<input type="text" id="wiki-tags" name="tags" value="${esc(draft.tags)}">
<div class="wiki-actions">
<button name="action" value="preview" class="secondary">Preview</button>
<button name="action" value="save">Save</button>
<a href="${esc(cancel)}">Cancel</a>
</div>
</form>`
}

export function renderEdit ({ draft, page = null, pages, preview = false, tabs, session }) {
  const cancel = page ? pagePath(page) : '/wiki/'
  const heading = page ? `Editing ${esc(page.title)}` : `New page: ${esc(draft.title || draft.slug)}`
  const previewHtml = preview
    ? `<section class="preview" aria-labelledby="preview-h"><h2 id="preview-h">Preview</h2>
<h1>${esc(draft.title)}</h1>
${contentHtml(draft.content, pages)}</section>`
    : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a>${page ? ` <span aria-hidden="true">›</span> <a href="${pagePath(page)}">${esc(page.title)}</a>` : ''}</nav>
<h1>${heading}</h1>
${preview ? '<p class="meta">Not saved yet.</p>' : ''}
${form({ draft, session, cancel })}
${previewHtml}`
  return wikiPage({ title: page ? `Edit: ${page.title}` : 'New page', body, tabs, session })
}

/** 409: keep the edit, base it on the current revision, show what the other save changed. */
export function renderConflict ({ draft, current, theirs, pages, tabs, session }) {
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a> <span aria-hidden="true">›</span> <a href="${pagePath(current)}">${esc(current.title)}</a></nav>
<h1>Edit conflict</h1>
<p role="alert">“${esc(current.title)}” was saved (revision ${current.revision}) after you started editing revision ${esc(String(draft.base))}. Your text is below and has <strong>not</strong> been saved. Merge in anything from the other change, then save again.</p>
<details open><summary>What the other change did</summary>
${renderDiff(theirs)}
</details>
${form({ draft: { ...draft, base: current.revision }, session, cancel: pagePath(current) })}
<details><summary>The current saved text</summary>${contentHtml(current.content, pages)}</details>`
  return wikiPage({ title: `Conflict: ${current.title}`, body, tabs, session })
}
