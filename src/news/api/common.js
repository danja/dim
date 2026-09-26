import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { formFields } from '../../common/http/write.js'
import { LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'

/** Shared bits of the news pages. */

export const itemPath = item => `/news/item/${item.id}`
export const feedPath = feed => `/news/feed/${feed.slug}`

export function newsPage ({ title, body, tabs, session }) {
  const scripts = session?.user ? `\n<script type="module" src="/static/js/news.js"></script>\n${LINK_PICKER_SCRIPT}` : ''
  return renderPage({ title, tabs, active: 'news', session, body, head: `<link rel="stylesheet" href="/static/css/news.css">${scripts}` })
}

/** "3 h ago", "2 Sep", "2 Sep 2024" — with the exact time in the attribute. */
export function when (iso, now = new Date()) {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const minutes = Math.round((now - t) / 60000)
  let label
  if (minutes < -1) label = minutes > -60 ? `in ${-minutes} min` : minutes > -24 * 60 ? `in ${Math.round(-minutes / 60)} h` : `on ${t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
  else if (minutes < 1) label = 'just now'
  else if (minutes < 60) label = `${minutes} min ago`
  else if (minutes < 24 * 60) label = `${Math.round(minutes / 60)} h ago`
  else label = t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  return `<time datetime="${esc(t.toISOString())}">${esc(label)}</time>`
}

export const STATUS_LABELS = Object.freeze({ new: 'not polled yet', ok: 'ok', 'not-modified': 'ok (unchanged)', error: 'error', refused: 'refused', gone: 'gone' })

export function statusBadge (feed) {
  const cls = ['error', 'refused', 'gone'].includes(feed.status) ? 'bad' : feed.status === 'new' ? 'muted' : 'ok'
  return `<span class="status ${cls}">${esc(STATUS_LABELS[feed.status] ?? feed.status)}</span>`
}

/** Read / star toggles for one item (forms; news.js makes them in-place). */
export function flagForms (item, { session, returnPath }) {
  if (!session?.user) return ''
  const toggle = (key, on, labelOn, labelOff, text) => `<form class="flag" method="post" action="/news/items/flags">${formFields(session, returnPath)}<input type="hidden" name="ids" value="${esc(item.id)}"><input type="hidden" name="${key}" value="${on ? 'false' : 'true'}"><button type="submit" data-flag="${key}" aria-pressed="${on}" aria-label="${esc(on ? labelOn : labelOff)}">${text}</button></form>`
  return `<div class="item-actions">${toggle('read', item.read, 'Mark unread', 'Mark read', item.read ? 'unread' : 'read')}${toggle('starred', item.starred, 'Unstar', 'Star', item.starred ? '★' : '☆')}</div>`
}

export function itemRow (item, { feeds, session, returnPath }) {
  const feed = feeds.get(item.feed)
  const title = esc(item.title)
  const heading = item.link
    ? `<a class="out" href="${esc(item.link)}" rel="noopener noreferrer" data-read-id="${esc(item.id)}">${title}</a>`
    : `<a href="${itemPath(item)}">${title}</a>`
  const meta = [feed ? `<a href="${feedPath(feed)}">${esc(feed.title)}</a>` : '', when(item.published ?? item.firstSeen), item.author ? esc(item.author) : '', `<a href="${itemPath(item)}">details</a>`].filter(Boolean).join(' · ')
  const snippet = item.snippet ? `<p class="snippet">${esc(item.snippet.replace(/\s+/g, ' ').slice(0, 280))}${item.snippet.length > 280 ? '…' : ''}</p>` : ''
  return `<li class="news-item${item.read ? ' read' : ''}${item.starred ? ' starred' : ''}" data-id="${esc(item.id)}">
<h2>${heading}</h2>
<p class="meta">${meta}</p>
${snippet}
${flagForms(item, { session, returnPath })}
</li>`
}
