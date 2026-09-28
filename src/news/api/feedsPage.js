import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { newsPage, statusBadge, when, feedPath } from './common.js'
import { renderItemList } from './river.js'

/** One feed's page (the list of them is the admin page). */

function feedSettings ({ feed, session }) {
  if (!session?.user) return ''
  const path = feedPath(feed)
  return `<div class="item-actions">
<form method="post" action="${path}/poll">${formFields(session, path)}<button class="secondary">${feed.parked ? 'Try again now' : 'Poll now'}</button></form>
<form method="post" action="${path}/${feed.parked ? 'unpark' : 'park'}">${formFields(session, path)}<button class="secondary">${feed.parked ? 'Return to reading' : 'Set aside'}</button></form>
<form method="post" action="${path}/delete" data-confirm="Unsubscribe and delete this feed's items?">${formFields(session, '/news/admin')}<button class="danger secondary">Unsubscribe</button></form>
</div>
<details><summary>Settings</summary>
<form class="edit" method="post" action="${path}">${formFields(session, path)}
<label for="feed-title">Title</label>
<input type="text" id="feed-title" name="title" value="${esc(feed.title)}" maxlength="300">
<label for="feed-tags">Tags (comma-separated)</label>
<input type="text" id="feed-tags" name="tags" value="${esc(feed.tags.join(', '))}">
<button>Save</button>
</form>
</details>`
}

/** alsoHere: what other facets have from the feed's site (registry.aboutDomain). */
export function renderFeedPage ({ feed, count, list, feeds, query, alsoHere = [], bookmarked = null, tabs, session }) {
  const path = feedPath(feed)
  const facts = [
    ['Feed', `<a href="${esc(feed.url)}" rel="noopener noreferrer">${esc(feed.url)}</a>`],
    feed.siteUrl ? ['Site', `<a href="${esc(feed.siteUrl)}" rel="noopener noreferrer">${esc(feed.siteUrl)}</a>`] : null,
    ['Status', `${statusBadge(feed)}${feed.lastError ? ` <span class="meta">${esc(feed.lastError)}</span>` : ''}${feed.parked ? ' <span class="meta">(failing: set aside, not read until tried again)</span>' : ''}`],
    ['Polled', feed.lastPolled ? `${when(feed.lastPolled)}${feed.nextPoll ? ` · next ${when(feed.nextPoll)}` : ''}` : 'not yet'],
    ['Items', `${count.unread} unread of ${count.total}${count.starred ? `, ${count.starred} starred` : ''}`],
    feed.tags.length ? ['Tags', feed.tags.map(t => `<a href="/news/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join(', ')] : null,
    alsoHere.length ? ['From this site', alsoHere.map(a => `<a href="${esc(a.href)}">${esc(a.label)}</a>`).join(', ')] : null
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/news/">News</a> <span aria-hidden="true">›</span> <a href="/news/admin">Manage feeds</a></nav>
<h1>${esc(feed.title)}</h1>
<dl class="facts">${facts}</dl>
${feedSettings({ feed, session })}
<h2>Items</h2>
${renderItemList({ ...list, feeds, query, session, returnPath: path + (query.view && query.view !== 'unread' ? `?view=${query.view}` : ''), basePath: path, bookmarked })}
<p class="meta"><a href="${path}?view=all">all items</a> · <a href="${path}?view=starred">starred</a></p>`
  return newsPage({ title: feed.title, body, tabs, session })
}
