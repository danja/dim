import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { formFields } from '../../common/http/write.js'
import { renderLinksPanel, LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'
import { appPath, postList, postArticle, neighbours } from '../render.js'
import { renderLinkHealth } from '../../common/ui/linkHealth.js'
import { renderRelated } from '../../common/ui/relatedPanel.js'

/** Blog pages in the app: index, tag, a post (with the owner's controls). */

export const tagHref = t => `/blog/tag/${encodeURIComponent(t)}`
const at = { postHref: appPath, tagHref }

export function blogPage ({ title, body, tabs, session }) {
  const head = `<link rel="stylesheet" href="/static/css/blog.css">
<link rel="alternate" type="application/atom+xml" title="Blog" href="/blog/feed.atom">${session?.user ? `\n${LINK_PICKER_SCRIPT}` : ''}`
  return renderPage({ title, tabs, active: 'blog', session, body, head })
}

function newPostForm (session) {
  if (!session?.user) return ''
  return `<form class="search" method="post" action="/blog/posts">${formFields(session, '')}
<input type="text" name="title" required placeholder="New post title" aria-label="New post title">
<button>New draft</button>
</form>
<p class="meta">Or start from a wiki page or outline item: its page has <strong>Draft a blog post</strong>.</p>`
}

export function renderIndex ({ published, drafts, blogTitle, tabs, session }) {
  const draftSection = session?.user && drafts.length
    ? `<section aria-labelledby="drafts-h"><h2 id="drafts-h">Drafts</h2>${postList(drafts, at)}</section>\n<h2>Published</h2>`
    : ''
  const body = `<h1>${esc(blogTitle)}</h1>
${newPostForm(session)}
${draftSection}
${postList(published, at)}
<p class="foot meta"><a href="/blog/feed.atom">Atom feed</a> · publish elsewhere with <code>node bin/blog-export.js</code></p>`
  return blogPage({ title: blogTitle, body, tabs, session })
}

export function renderTag ({ tag, posts, tabs, session }) {
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/blog/">Blog</a></nav>
<h1>Tagged “${esc(tag)}”</h1>
${postList(posts, at)}
<p class="meta"><a href="/tags/${encodeURIComponent(tag)}">Everything tagged “${esc(tag)}”</a></p>`
  return blogPage({ title: `Tagged ${tag}`, body, tabs, session })
}

function ownerControls (post, session) {
  if (!session?.user) return ''
  const path = `/blog/post/${post.slug}`
  const publish = post.status === 'published'
    ? `<form method="post" action="${path}/publish">${formFields(session, '')}<input type="hidden" name="publish" value="false"><button class="secondary">Unpublish</button></form>`
    : `<form method="post" action="${path}/publish">${formFields(session, '')}<input type="hidden" name="publish" value="true"><button>Publish</button></form>`
  return `<div class="blog-actions">
<a class="button secondary" href="${path}/edit">Edit</a>
${publish}
<form method="post" action="${path}/delete" data-confirm="Delete this post?">${formFields(session, '/blog/')}<button class="secondary danger">Delete</button></form>
</div>`
}

export function renderPost ({ post, posts, published, source, links, related = null, badLinks = [], tabs, session }) {
  const linksHtml = renderLinksPanel(links, { subject: post.iri, session, returnPath: appPath(post) })
  const from = source ? `<p class="meta">Started from <a href="${esc(source.href)}">${esc(source.label)}</a> (${esc(source.facetLabel ?? '')})</p>` : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/blog/">Blog</a></nav>
${ownerControls(post, session)}
${postArticle(post, { posts, ...at, ...neighbours(post, published) })}
${session?.user ? from : ''}
${session?.user ? renderLinkHealth(badLinks) : ''}
${renderRelated(related)}
${linksHtml}
<p class="foot meta">export: <a href="/blog/post/${esc(post.slug)}.md">Markdown</a> · <a href="/blog/post/${esc(post.slug)}.json">JSON</a></p>`
  return blogPage({ title: post.title, body, tabs, session })
}
