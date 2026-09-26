import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { newsPage, statusBadge, when, feedPath } from './common.js'
import { renderItemList } from './river.js'

/** Subscriptions: the list (add, import, export, poll) and one feed. */

function addForms (session) {
  if (!session?.user) return session?.writesEnabled ? '<p class="meta"><a href="/login?return=/news/feeds">Log in</a> to subscribe.</p>' : ''
  return `<form class="edit" method="post" action="/news/feeds">${formFields(session, '')}
<label for="feed-url">Feed or web page URL</label>
<input type="url" id="feed-url" name="url" required placeholder="https://example.org/ (its feed is found for you)">
<label for="feed-tags">Tags (comma-separated, optional)</label>
<input type="text" id="feed-tags" name="tags">
<button>Subscribe</button>
</form>
<details><summary>Import a list (OPML, or one URL per line)</summary>
<form class="edit" method="post" action="/news/feeds/import">${formFields(session, '/news/feeds')}
<label for="feed-list">Paste OPML or URLs</label>
<textarea id="feed-list" name="list" rows="8"></textarea>
<button>Import</button>
</form>
</details>`
}

export function renderFeedsPage ({ feeds, counts, notice, tabs, session }) {
  const rows = feeds.map(f => {
    const c = counts.get(f.iri) ?? { total: 0, unread: 0 }
    return `<li class="feed-row">
<h2><a href="${feedPath(f)}">${esc(f.title)}</a></h2>
<p class="meta">${statusBadge(f)} · ${c.unread} unread of ${c.total}${f.lastPolled ? ` · polled ${when(f.lastPolled)}` : ''}${f.tags.length ? ` · ${esc(f.tags.join(', '))}` : ''}</p>
</li>`
  }).join('')
  const pollAll = session?.user && feeds.length
    ? `<form method="post" action="/news/poll">${formFields(session, '/news/?polling=1')}<button class="secondary">Poll due feeds now</button></form>`
    : ''
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/news/">News</a></nav>
<h1>Feeds</h1>
${notice ? `<p role="status">${esc(notice)}</p>` : ''}
${addForms(session)}
${pollAll}
${rows ? `<ul class="feeds">${rows}</ul>` : '<p class="muted">No subscriptions yet.</p>'}
<p class="foot meta">export: <a href="/news/feeds.opml">OPML</a></p>`
  return newsPage({ title: 'Feeds', body, tabs, session })
}

function feedSettings ({ feed, session }) {
  if (!session?.user) return ''
  const path = feedPath(feed)
  return `<div class="item-actions">
<form method="post" action="${path}/poll">${formFields(session, path)}<button class="secondary">Poll now</button></form>
<form method="post" action="${path}/delete" data-confirm="Unsubscribe and delete this feed's items?">${formFields(session, '/news/feeds')}<button class="danger secondary">Unsubscribe</button></form>
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

export function renderFeedPage ({ feed, count, list, feeds, query, tabs, session }) {
  const path = feedPath(feed)
  const facts = [
    ['Feed', `<a href="${esc(feed.url)}" rel="noopener noreferrer">${esc(feed.url)}</a>`],
    feed.siteUrl ? ['Site', `<a href="${esc(feed.siteUrl)}" rel="noopener noreferrer">${esc(feed.siteUrl)}</a>`] : null,
    ['Status', `${statusBadge(feed)}${feed.lastError ? ` <span class="meta">${esc(feed.lastError)}</span>` : ''}`],
    ['Polled', feed.lastPolled ? `${when(feed.lastPolled)}${feed.nextPoll ? ` · next ${when(feed.nextPoll)}` : ''}` : 'not yet'],
    ['Items', `${count.unread} unread of ${count.total}${count.starred ? `, ${count.starred} starred` : ''}`],
    feed.tags.length ? ['Tags', feed.tags.map(t => `<a href="/news/?tag=${encodeURIComponent(t)}">${esc(t)}</a>`).join(', ')] : null
  ].filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/news/">News</a> <span aria-hidden="true">›</span> <a href="/news/feeds">Feeds</a></nav>
<h1>${esc(feed.title)}</h1>
<dl class="facts">${facts}</dl>
${feedSettings({ feed, session })}
<h2>Items</h2>
${renderItemList({ ...list, feeds, query, session, returnPath: path + (query.view && query.view !== 'unread' ? `?view=${query.view}` : ''), basePath: path })}
<p class="meta"><a href="${path}?view=all">all items</a> · <a href="${path}?view=starred">starred</a></p>`
  return newsPage({ title: feed.title, body, tabs, session })
}
