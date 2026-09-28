import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { newsPage, statusBadge, when, feedPath } from './common.js'

/**
 * Managing subscriptions: add, import, the inbox of feeds found on your
 * bookmarks (subscribe, dismiss), and two lists — feeds being polled, and
 * failing ones set aside (not polled) — with reread, set aside/return and
 * delete for whatever is ticked.
 */

export const ADMIN_PATH = '/news/admin'

function addForms (session) {
  return `<details class="admin-add"><summary>Add a feed</summary>
<form class="edit" method="post" action="/news/feeds">${formFields(session, '')}
<label for="feed-url">Feed or web page URL</label>
<input type="url" id="feed-url" name="url" required placeholder="https://example.org/ (its feed is found for you)">
<label for="feed-tags">Tags (comma-separated, optional)</label>
<input type="text" id="feed-tags" name="tags">
<button>Subscribe</button>
</form>
</details>
<details class="admin-add"><summary>Import a list (OPML, or one URL per line)</summary>
<form class="edit" method="post" action="/news/feeds/import">${formFields(session, '')}
<label for="feed-list">Paste OPML or URLs</label>
<textarea id="feed-list" name="list" rows="8"></textarea>
<button>Import</button>
</form>
</details>`
}

function feedLine (f, counts, { group, canEdit }) {
  const c = counts.get(f.iri) ?? { total: 0, unread: 0 }
  const facts = f.parked
    ? [statusBadge(f), f.lastError ? esc(f.lastError) : '', `${f.failures} failure${f.failures === 1 ? '' : 's'} in a row`, f.lastPolled ? `last tried ${when(f.lastPolled)}` : '']
    : [statusBadge(f), `${c.unread} unread of ${c.total}`, f.lastPolled ? `polled ${when(f.lastPolled)}` : 'not polled yet', f.tags.length ? esc(f.tags.join(', ')) : '']
  const title = `<a href="${feedPath(f)}">${esc(f.title)}</a>`
  const head = canEdit
    ? `<input type="checkbox" name="slugs" value="${esc(f.slug)}" data-group="${group}" aria-label="Tick ${esc(f.title)}"> ${title}`
    : title
  return `<li class="feed-row"><h3>${head}</h3><p class="meta">${facts.filter(Boolean).join(' · ')}</p></li>`
}

function section ({ id, heading, intro, feeds, counts, canEdit, actions }) {
  const selectAll = canEdit && feeds.length > 1
    ? `<label class="select-all" hidden><input type="checkbox" data-select-all="${id}"> Select all</label>`
    : ''
  const buttons = canEdit && feeds.length ? `<div class="item-actions">${actions}</div>` : ''
  const list = feeds.length
    ? `<ul class="feeds">${feeds.map(f => feedLine(f, counts, { group: id, canEdit })).join('')}</ul>`
    : '<p class="muted">None.</p>'
  return `<section aria-labelledby="${id}-heading">
<h2 id="${id}-heading">${heading} (${feeds.length})</h2>
${intro ? `<p class="meta">${intro}</p>` : ''}
${buttons}
${selectAll}
${list}
</section>`
}

function suggestionLine (s, { canEdit }) {
  const label = s.title || s.url
  const found = s.source
    ? `found on <a href="${esc(s.source.href)}">${esc(s.source.label)}</a>`
    : s.foundOn ? `found on <a href="${esc(s.foundOn)}" rel="noopener noreferrer">${esc(s.foundOn)}</a>` : ''
  const more = s.sources.length > 1 ? ` and ${s.sources.length - 1} more` : ''
  const head = `${canEdit ? `<input type="checkbox" name="suggestions" value="${esc(s.id)}" data-group="inbox" aria-label="Tick ${esc(label)}"> ` : ''}<a href="${esc(s.url)}" rel="noopener noreferrer">${esc(label)}</a>`
  return `<li class="feed-row"><h3>${head}</h3><p class="meta">${[s.title ? esc(s.url) : '', found + more].filter(Boolean).join(' · ')}</p></li>`
}

/** Feeds found on bookmarked pages, waiting to be subscribed to or dismissed. */
function inboxSection (suggestions, { canEdit }) {
  if (!suggestions?.length) return ''
  const selectAll = canEdit && suggestions.length > 1 ? '<label class="select-all" hidden><input type="checkbox" data-select-all="inbox"> Select all</label>' : ''
  const buttons = canEdit ? '<div class="item-actions"><button name="action" value="subscribe">Subscribe to ticked</button><button name="action" value="dismiss" class="secondary">Dismiss ticked</button></div>' : ''
  return `<section aria-labelledby="inbox-heading">
<h2 id="inbox-heading">Found on your bookmarks (${suggestions.length})</h2>
<p class="meta">Feeds offered by pages you bookmarked. Subscribing reads them straight away; a dismissed one isn't suggested again.</p>
${buttons}
${selectAll}
<ul class="feeds">${suggestions.map(s => suggestionLine(s, { canEdit })).join('')}</ul>
</section>`
}

export function renderAdminPage ({ feeds, counts, suggestions = null, notice, polling, tabs, session }) {
  const canEdit = Boolean(session?.user)
  const active = feeds.filter(f => !f.parked)
  const failing = feeds.filter(f => f.parked)
  const button = (action, label, { danger = false } = {}) => `<button name="action" value="${action}" class="${danger ? 'danger ' : ''}secondary"${danger ? ' data-confirm="Unsubscribe from the ticked feeds and delete their items?"' : ''}>${label}</button>`
  const lists = `${inboxSection(suggestions, { canEdit })}
${section({
    id: 'active',
    heading: 'Being read',
    feeds: active,
    counts,
    canEdit,
    actions: button('reread', 'Reread ticked') + button('reread-all', 'Reread all') + button('park', 'Set ticked aside') + button('delete', 'Delete ticked', { danger: true })
  })}
${section({
    id: 'failing',
    heading: 'Failing, set aside',
    intro: 'Not read until you try again. A feed that works when tried goes back to the list above.',
    feeds: failing,
    counts,
    canEdit,
    actions: button('reread', 'Try ticked again') + button('unpark', 'Return ticked to reading') + button('delete', 'Delete ticked', { danger: true })
  })}`
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/news/">News</a></nav>
<h1>Manage feeds</h1>
${notice ? `<p role="status">${esc(notice)}</p>` : ''}
${polling ? '<p class="meta" role="status">Reading feeds in the background; reload in a minute to see the results.</p>' : ''}
${canEdit ? addForms(session) : session?.writesEnabled ? `<p class="meta"><a href="/login?return=${ADMIN_PATH}">Log in</a> to add, reread or delete feeds.</p>` : ''}
${canEdit ? `<form class="admin-feeds" method="post" action="${ADMIN_PATH}">${formFields(session, '')}${lists}</form>` : lists}
<p class="foot meta">export: <a href="/news/feeds.opml">OPML</a></p>`
  return newsPage({ title: 'Manage feeds', body, tabs, session })
}
