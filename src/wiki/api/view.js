import { esc } from '../../common/http/respond.js'
import { renderLinksPanel } from '../../common/ui/linksPanel.js'
import { formFields } from '../../common/http/write.js'
import { renderLinkHealth } from '../../common/ui/linkHealth.js'
import { pagePath, contentHtml, wikiPage, when, renderDiff } from './common.js'
import { renderRelated } from '../../common/ui/relatedPanel.js'

/** Wiki reading pages: the index, a page, a missing page, history, diffs. */

function tagLinks (tags) {
  return tags.map(t => `<a class="tag" href="/wiki/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join(' ')
}

function newPageForm (session) {
  if (!session?.user) return ''
  return `<form class="search" method="get" action="/wiki/new">
<input type="text" name="title" required placeholder="New page title" aria-label="New page title">
<button>Create</button>
</form>`
}

/** A one-line plain-text taste of a page: its first prose line, markdown marks dropped. */
function excerpt (content, max = 140) {
  const line = String(content ?? '').split('\n').map(l => l.trim()).find(l => l && !/^(#|---|```|[-*] \[)/.test(l)) ?? ''
  const text = line.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, t, label) => label ?? t).replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#]/g, '').trim()
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function recentCards (pages) {
  const recent = pages.slice().sort((a, b) => (b.modified ?? b.created ?? '').localeCompare(a.modified ?? a.created ?? '')).slice(0, 8)
  if (!recent.length) return ''
  return `<h2>Recently changed</h2>
<ul class="wiki-recent">${recent.map(p => `<li><a href="${pagePath(p)}">${esc(p.title)}</a> <small class="meta">r${p.revision} · ${when(p.modified ?? p.created)}</small>${excerpt(p.content) ? `<p>${esc(excerpt(p.content))}</p>` : ''}</li>`).join('')}</ul>`
}

function tagCloud (pages) {
  const counts = new Map()
  for (const t of pages.flatMap(p => p.tags)) counts.set(t, (counts.get(t) ?? 0) + 1)
  if (!counts.size) return ''
  const tags = [...counts].sort((a, b) => a[0].localeCompare(b[0]))
  return `<h2>Tags</h2><p>${tags.map(([t, n]) => `<a class="tag" href="/wiki/?tag=${encodeURIComponent(t)}">${esc(t)} <small>${n}</small></a>`).join(' ')}</p>`
}

function pageList (pages) {
  return `<ul class="wiki-index">${pages.map(p => `<li><a href="${pagePath(p)}">${esc(p.title)}</a>${p.tags.length ? ` <small class="meta">${esc(p.tags.join(', '))}</small>` : ''}</li>`).join('')}</ul>`
}

export function renderIndex ({ pages, tag, tabs, session }) {
  const sorted = pages.slice().sort((a, b) => a.title.localeCompare(b.title))
  const header = `<h1>${tag ? `Wiki pages tagged “${esc(tag)}”` : 'Wiki'}</h1>\n${newPageForm(session)}`
  let main
  if (tag) {
    const shown = sorted.filter(p => p.tags.includes(tag))
    main = `<p><a href="/wiki/">All pages</a> · <a href="/tags/${encodeURIComponent(tag)}">everything tagged “${esc(tag)}”</a></p>
${shown.length ? pageList(shown) : '<p class="muted">No pages carry this tag.</p>'}`
  } else if (!pages.length) {
    main = '<p class="muted">No pages yet. Create one above, follow a <code>[[Title]]</code> link, or import with <code>node bin/wiki-import.js</code>.</p>'
  } else {
    main = `${recentCards(pages)}
${tagCloud(pages)}
<details class="wiki-all"><summary>All pages (${pages.length})</summary>${pageList(sorted)}</details>`
  }
  return wikiPage({ title: 'Wiki', body: `${header}\n${main}`, tabs, session })
}

function pageActions ({ page, session }) {
  if (!session?.user) return ''
  return `<div class="node-actions">
<a class="button" href="${pagePath(page)}/edit">Edit</a>
<form class="inline-buttons" method="post" action="/blog/posts">${formFields(session, '')}<input type="hidden" name="from" value="${esc(page.iri)}"><button>Draft a blog post</button></form>
<form class="inline-buttons" method="post" action="/farelo/tasks/from" data-confirm="Move this page into a task? The page is deleted with its history.">${formFields(session, '')}<input type="hidden" name="from" value="${esc(page.iri)}"><button>Move to a task</button></form>
<form class="inline-buttons" method="post" action="${pagePath(page)}/delete" data-confirm="Delete this page and its history?">${formFields(session, '/wiki/')}<button class="danger">Delete</button></form>
</div>`
}

export function renderView ({ page, pages, links, related = null, badLinks = [], tabs, session }) {
  const linksHtml = renderLinksPanel(links, { subject: page.iri, session, returnPath: pagePath(page) })
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a></nav>
<h1>${esc(page.title)}</h1>
${page.tags.length ? `<p>${tagLinks(page.tags)}</p>` : ''}
${pageActions({ page, session })}
${contentHtml(page.content, pages)}
${session?.user ? renderLinkHealth(badLinks) : ''}
${renderRelated(related)}
${linksHtml}
<p class="foot meta">revision ${page.revision} · ${when(page.modified ?? page.created)} · <a href="${pagePath(page)}/history">history</a> · export: <a href="${pagePath(page)}.md">Markdown</a> · <a href="${pagePath(page)}.ttl">Turtle</a></p>`
  return wikiPage({ title: page.title, body, tabs, session })
}

/** A page that doesn't exist yet: say so, and offer to write it. */
export function renderMissing ({ slug, title, tabs, session }) {
  const name = title || slug.replace(/-/g, ' ')
  const offer = session?.user
    ? `<p><a class="button" href="/wiki/page/${esc(slug)}/edit?title=${encodeURIComponent(name)}">Create “${esc(name)}”</a></p>`
    : session?.writesEnabled ? `<p><a href="/login?return=${encodeURIComponent(`/wiki/page/${slug}/edit?title=${encodeURIComponent(name)}`)}">Log in</a> to create it.</p>` : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a></nav>
<h1>${esc(name)}</h1>
<p class="muted">There is no page with this name yet.</p>
${offer}
<p><a href="/find?q=${encodeURIComponent(name)}">Search everything for “${esc(name)}”</a></p>`
  return wikiPage({ title: name, body, tabs, session })
}

export function renderHistory ({ page, revisions, tabs, session }) {
  const path = pagePath(page)
  const rows = revisions.map(r => {
    const compare = r.n > 1 ? ` · <a href="${path}/diff?from=${r.n - 1}&to=${r.n}">changes</a>` : ''
    return `<li><a href="${path}/r/${r.n}">revision ${r.n}</a> <small class="meta">${when(r.created)}${r.actor ? ` · ${esc(r.actor)}` : ''}${r.title !== page.title ? ` · “${esc(r.title)}”` : ''}</small>${compare}</li>`
  }).join('')
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a> <span aria-hidden="true">›</span> <a href="${path}">${esc(page.title)}</a></nav>
<h1>History of ${esc(page.title)}</h1>
<ol class="history" reversed>${rows}</ol>`
  return wikiPage({ title: `History: ${page.title}`, body, tabs, session })
}

export function renderRevision ({ page, revision, pages, tabs, session }) {
  const path = pagePath(page)
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a> <span aria-hidden="true">›</span> <a href="${path}">${esc(page.title)}</a> <span aria-hidden="true">›</span> <a href="${path}/history">history</a></nav>
<h1>${esc(revision.title)} <small class="meta">revision ${revision.n} of ${page.revision}</small></h1>
<p class="meta">${when(revision.created)}${revision.n < page.revision ? ` · <a href="${path}/diff?from=${revision.n}&to=${page.revision}">compare with the current text</a>` : ' · the current text'}</p>
${contentHtml(revision.content, pages)}`
  return wikiPage({ title: `${revision.title} (r${revision.n})`, body, tabs, session })
}

export function renderDiffPage ({ page, from, to, diff, stats, tabs, session }) {
  const path = pagePath(page)
  const titleChange = from.title !== to.title ? `<p>Title: “${esc(from.title)}” → “${esc(to.title)}”</p>` : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/wiki/">Wiki</a> <span aria-hidden="true">›</span> <a href="${path}">${esc(page.title)}</a> <span aria-hidden="true">›</span> <a href="${path}/history">history</a></nav>
<h1>Changes: revision ${from.n} → ${to.n}</h1>
<p class="meta">${stats ? `${stats.added} line${stats.added === 1 ? '' : 's'} added, ${stats.removed} removed` : ''}</p>
${titleChange}
${renderDiff(diff)}`
  return wikiPage({ title: `Changes: ${page.title}`, body, tabs, session })
}
