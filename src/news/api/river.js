import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { renderLinksPanel } from '../../common/ui/linksPanel.js'
import { newsPage, itemRow, flagForms, when, itemPath, feedPath } from './common.js'

/** The river of items (with filters and paging) and one item's page. */

const VIEWS = [['unread', 'Unread'], ['starred', 'Starred'], ['all', 'All']]

export function riverQuery ({ view, feed, tag, before }) {
  const params = new URLSearchParams()
  if (view && view !== 'unread') params.set('view', view)
  if (feed) params.set('feed', feed)
  if (tag) params.set('tag', tag)
  if (before) params.set('before', before)
  const s = params.toString()
  return s ? `?${s}` : ''
}

function filters ({ query, feedList, tags, unread }) {
  const views = VIEWS.map(([v, label]) => {
    const current = (query.view ?? 'unread') === v ? ' aria-current="page"' : ''
    const count = v === 'unread' ? ` <span class="count">${unread}</span>` : ''
    return `<a href="/news/${riverQuery({ ...query, view: v, before: null })}"${current}>${label}${count}</a>`
  }).join('')
  const feedOptions = feedList.map(f => `<option value="${esc(f.slug)}"${query.feed === f.slug ? ' selected' : ''}>${esc(f.title)}</option>`).join('')
  const tagOptions = tags.map(t => `<option value="${esc(t)}"${query.tag === t ? ' selected' : ''}>${esc(t)}</option>`).join('')
  return `<nav class="views" aria-label="Which items">${views}</nav>
<form class="news-filter" method="get" action="/news/">
${query.view && query.view !== 'unread' ? `<input type="hidden" name="view" value="${esc(query.view)}">` : ''}
<label>Feed <select name="feed"><option value="">all feeds</option>${feedOptions}</select></label>
${tags.length ? `<label>Tag <select name="tag"><option value="">any</option>${tagOptions}</select></label>` : ''}
<button>Show</button>
</form>`
}

/** The list itself, shared by the river and a feed's page. */
export function renderItemList ({ items, more, feeds, query, session, returnPath, basePath = '/news/', bookmarked = null }) {
  if (!items.length) {
    return `<p class="muted">${(query.view ?? 'unread') === 'unread' ? 'Nothing unread.' : 'No items.'}${feeds.size ? '' : ' Subscribe to feeds on the <a href="/news/feeds">Feeds</a> page.'}</p>`
  }
  const markAll = session?.user && (query.view ?? 'unread') === 'unread'
    ? `<form class="mark-all" method="post" action="/news/items/flags">${formFields(session, returnPath)}<input type="hidden" name="ids" value="${esc(items.map(i => i.id).join(','))}"><input type="hidden" name="read" value="true"><button class="secondary">Mark these ${items.length} read</button></form>`
    : ''
  const last = items.at(-1)
  const older = more ? `<p><a class="button" href="${basePath}${riverQuery({ ...query, before: last.published ?? last.firstSeen })}">Older →</a></p>` : ''
  return `<ol class="river">${items.map(i => itemRow(i, { feeds, session, returnPath, bookmarked })).join('\n')}</ol>
${markAll}
${older}`
}

export function renderRiver ({ items, more, feeds, feedList, tags, unread, query, polling, tabs, session, returnPath, bookmarked = null }) {
  const body = `<div class="news-head"><h1>News</h1><a href="/news/feeds">Feeds (${feedList.length})</a></div>
${polling ? '<p class="meta" role="status">Polling feeds in the background; reload in a minute.</p>' : ''}
${filters({ query, feedList, tags, unread })}
${renderItemList({ items, more, feeds, query, session, returnPath, bookmarked })}`
  return newsPage({ title: 'News', body, tabs, session })
}

function saveForms ({ item, session, bookmark }) {
  const already = bookmark ? `<p class="meta">Already bookmarked: <a href="${esc(bookmark.href)}">${esc(bookmark.label)}</a></p>` : ''
  if (!session?.user) return already
  const path = itemPath(item)
  return `${already}<div class="item-actions save">
${item.link && !bookmark ? `<form method="post" action="${path}/bookmark">${formFields(session, path)}<button class="secondary">Save as bookmark</button></form>` : ''}
<form method="post" action="${path}/task">${formFields(session, '')}<button class="secondary">Make a task</button></form>
</div>`
}

function paragraphs (text) {
  return String(text ?? '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')
}

export function renderItemPage ({ item, feed, text, links, bookmark = null, tabs, session }) {
  const path = itemPath(item)
  const linksHtml = renderLinksPanel(links, { subject: item.iri, session, returnPath: path })
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/news/">News</a>${feed ? ` <span aria-hidden="true">›</span> <a href="${feedPath(feed)}">${esc(feed.title)}</a>` : ''}</nav>
<h1>${esc(item.title)}</h1>
<p class="meta">${[when(item.published ?? item.firstSeen), item.author ? esc(item.author) : '', item.categories.length ? esc(item.categories.join(', ')) : ''].filter(Boolean).join(' · ')}</p>
${item.link ? `<p><a class="button" href="${esc(item.link)}" rel="noopener noreferrer" data-read-id="${esc(item.id)}">Read the original</a></p>` : ''}
${flagForms(item, { session, returnPath: path })}
<div class="item-text">${paragraphs(text ?? item.snippet) || '<p class="muted">The feed gave no text for this item.</p>'}</div>
${saveForms({ item, session, bookmark })}
${linksHtml}
<p class="foot meta">first seen ${when(item.firstSeen)} · <a href="${path}.json">JSON</a></p>`
  return newsPage({ title: item.title, body, tabs, session })
}
