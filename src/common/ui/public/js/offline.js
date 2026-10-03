/* eslint-env browser */
// Squirt offline: keep the 10 newest news summaries on this device, take
// notes and captures while offline, and send them when the connection is back.
// Pages work without this; it only enhances them.

import { saveNews, loadNews, queued, enqueue, attempt, noteOnItem, flush, NEWS_COUNT } from './offlineQueue.js'

const capture = document.querySelector('#capture')
const panel = document.querySelector('#offline-news')
const status = document.querySelector('#offline-status')
const csrf = () => document.querySelector('input[name="_csrf"]')?.value ?? ''

function say (text) { if (status) status.textContent = text }

function pending () {
  const n = queued(localStorage).length
  say(n ? `${n} saved on this device, waiting to sync.` : '')
}

async function send (item) {
  const response = await fetch('/squirt/capture', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ...item, _csrf: csrf() })
  })
  return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) }
}

let syncing = null

// One flush at a time: two at once would each send the first queued capture.
function sync () {
  if (!queued(localStorage).length || !csrf()) return syncing
  syncing ??= run().finally(() => { syncing = null })
  return syncing
}

async function run () {
  const { sent, dropped, left } = await flush(localStorage, send)
  if (sent || dropped) say(`Synced ${sent}${dropped ? `, ${dropped} refused by the server` : ''}${left ? `; ${left} still waiting` : ''}.`)
  else pending()
}

async function refreshNews () {
  try {
    const response = await fetch(`/news/items.json?view=all&limit=${NEWS_COUNT}`, { headers: { Accept: 'application/json' } })
    if (response.ok) saveNews(localStorage, (await response.json()).items)
  } catch { /* offline: keep the copy we have */ }
}

function render () {
  if (!panel) return
  const { at, items } = loadNews(localStorage)
  panel.replaceChildren()
  if (!items.length) { panel.hidden = true; return }
  const heading = document.createElement('h2')
  heading.textContent = 'News on this device'
  const meta = document.createElement('p')
  meta.className = 'meta'
  meta.textContent = `Newest ${items.length}, as of ${at?.slice(0, 16).replace('T', ' ')}. Notes you add offline are sent when you are back online.`
  panel.append(heading, meta)
  for (const item of items) {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = item.title
    const text = document.createElement('p')
    text.textContent = item.summary || 'No summary.'
    const form = document.createElement('form')
    form.className = 'edit'
    const label = document.createElement('label')
    label.textContent = 'Add a note'
    const box = document.createElement('textarea')
    box.rows = 2
    label.append(box)
    const button = document.createElement('button')
    button.textContent = 'Save note'
    form.append(label, button)
    form.addEventListener('submit', async e => {
      e.preventDefault()
      if (!box.value.trim()) return
      enqueue(localStorage, noteOnItem(item, box.value))
      box.value = ''
      pending()
      await sync()
    })
    const link = document.createElement('a')
    link.href = item.href
    link.textContent = 'Open item'
    details.append(summary, text, link, form)
    panel.append(details)
  }
  panel.hidden = false
}

// The capture form: send it, and if DIM can't be reached (offline, or the
// server is down while the network is up) keep it here instead of losing it.
capture?.addEventListener('submit', async e => {
  e.preventDefault()
  const data = Object.fromEntries(new FormData(capture))
  if (!String(data.text ?? '').trim() && !data.url) return
  const item = { text: data.text, url: data.url, title: data.title, kind: data.kind }
  const { state, result } = await attempt(localStorage, item, send)
  if (state === 'sent') {
    const { href, label } = result.body
    location.assign(`/squirt/?captured=${encodeURIComponent(href ?? '')}&label=${encodeURIComponent(label ?? '')}`)
  } else if (state === 'queued') {
    capture.reset()
    say(`Saved on this device. ${queued(localStorage).length} waiting; they are sent when DIM can be reached.`)
  } else if (state === 'refused') say(`Not saved: ${result.body.error ?? `the server refused it (${result.status})`}`)
  else say('Could not save on this device (storage full).')
})

// The share target arrives as /squirt/share?title=…&url=…; when that page is
// served from the offline copy its form is stale, so fill it from the address.
if (capture && location.pathname === '/squirt/share') {
  const params = new URLSearchParams(location.search)
  for (const name of ['title', 'text', 'url']) {
    if (!params.has(name)) continue
    let field = capture.elements[name]
    if (!field) {
      field = Object.assign(document.createElement('input'), { type: 'hidden', name })
      capture.append(field)
    }
    field.value = params.get(name)
  }
}

// The server coming back raises no event, so while anything is waiting, retry.
setInterval(() => { if (!document.hidden) sync() }, 30000)
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync() })
window.addEventListener('online', async () => { await sync(); await refreshNews(); render() })
render()
pending()
if (navigator.onLine) refreshNews().then(() => { render(); return sync() })
