import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { appPath, postHtml } from '../render.js'
import { blogPage } from './pages.js'
import { renderLinkHealth } from '../../common/ui/linkHealth.js'

/** The post editor, with a server-rendered preview. draft: the form's values. */
export function renderEdit ({ post, draft = post, posts, preview = false, badLinks = [], tabs, session }) {
  const tags = Array.isArray(draft.tags) ? draft.tags.join(', ') : draft.tags ?? ''
  const previewHtml = preview
    ? `<section class="preview" aria-labelledby="preview-h"><h2 id="preview-h">Preview</h2>
<article class="post"><h1>${esc(draft.title)}</h1><div class="post-body">${postHtml(draft.content, { posts, postHref: appPath })}</div></article>
${renderLinkHealth(badLinks)}</section>`
    : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/blog/">Blog</a> <span aria-hidden="true">›</span> <a href="${appPath(post)}">${esc(post.title)}</a></nav>
<h1>Editing ${post.status === 'draft' ? 'draft' : 'post'}</h1>
${preview ? '<p class="meta">Not saved yet.</p>' : ''}
<form class="edit post-edit" method="post" action="/blog/post/${esc(post.slug)}">${formFields(session, '')}
<label for="post-title">Title</label>
<input type="text" id="post-title" name="title" required maxlength="200" value="${esc(draft.title)}">
<label for="post-content">Text (Markdown; <code>[[Post title]]</code> links to a post)</label>
<textarea id="post-content" name="content" rows="20">${esc(draft.content)}</textarea>
<label for="post-abstract">Summary for lists and the feed (optional; otherwise the first paragraph)</label>
<textarea id="post-abstract" name="abstract" rows="3" maxlength="1000">${esc(draft.abstract ?? '')}</textarea>
<label for="post-tags">Tags (comma-separated)</label>
<input type="text" id="post-tags" name="tags" value="${esc(tags)}">
<div class="blog-actions">
<button name="action" value="preview" class="secondary">Preview</button>
<button name="action" value="save">Save</button>
<a href="${appPath(post)}">Cancel</a>
</div>
</form>
${previewHtml}`
  return blogPage({ title: `Edit: ${post.title}`, body, tabs, session })
}
