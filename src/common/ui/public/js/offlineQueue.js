// Squirt offline: the last news summaries and the captures waiting to sync,
// kept in localStorage. Pure logic over a Storage-like object (tested).

export const NEWS_KEY = 'dim.offline.news'
export const QUEUE_KEY = 'dim.offline.queue'
export const NEWS_COUNT = 10
const MAX_QUEUE = 200

function read (storage, key, fallback) {
  try {
    const value = JSON.parse(storage.getItem(key))
    return value ?? fallback
  } catch { return fallback }
}

function write (storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

/** Keep the newest NEWS_COUNT items, reduced to what reading offline needs. */
export function saveNews (storage, items, now = () => new Date()) {
  const kept = (items ?? []).slice(0, NEWS_COUNT).map(i => ({
    id: i.id, title: i.title, link: i.link ?? null, href: i.href, published: i.published ?? null, summary: i.snippet ?? i.summary ?? ''
  }))
  return write(storage, NEWS_KEY, { at: now().toISOString(), items: kept })
}

export function loadNews (storage) {
  const saved = read(storage, NEWS_KEY, { at: null, items: [] })
  return { at: saved.at ?? null, items: Array.isArray(saved.items) ? saved.items : [] }
}

export function queued (storage) {
  const list = read(storage, QUEUE_KEY, [])
  return Array.isArray(list) ? list : []
}

/** Add a capture ({ text, url, title, kind }) to the queue. false if it won't fit. */
export function enqueue (storage, capture, now = () => new Date()) {
  const list = queued(storage)
  if (list.length >= MAX_QUEUE) return false
  list.push({ ...capture, queuedAt: now().toISOString() })
  return write(storage, QUEUE_KEY, list)
}

/** Whether a failed send is worth retrying later (server down or session expired), not a refusal. */
export function retryable (status) {
  return status >= 500 || status === 401 || status === 403
}

/**
 * Send a capture now; if DIM can't be reached (network error, 5xx from a proxy
 * with the app down, expired session) keep it in the queue instead.
 * → { state: 'sent' | 'queued' | 'refused' | 'full', result? }
 */
export async function attempt (storage, item, send, now = () => new Date()) {
  let result
  try { result = await send(item) } catch { result = null }
  if (result?.ok) return { state: 'sent', result }
  if (result && !retryable(result.status)) return { state: 'refused', result }
  return { state: enqueue(storage, item, now) ? 'queued' : 'full', result }
}

/** The capture for a note written offline on a news item. Always a note, never a bookmark. */
export function noteOnItem (item, note) {
  const text = [`Re: ${item.title}`, String(note).trim(), item.link].filter(Boolean).join('\n\n')
  return { text, kind: 'note' }
}

/**
 * Send queued captures in order with send(capture) → Promise<{ ok, status }>.
 * A network failure stops (try again later); a 4xx drops that capture, which
 * would never succeed. → { sent, dropped, left }
 */
export async function flush (storage, send) {
  const list = queued(storage)
  let sent = 0
  let dropped = 0
  while (list.length) {
    let result
    try { result = await send(list[0]) } catch { break }
    if (!result.ok && retryable(result.status)) break
    if (result.ok) sent++
    else dropped++
    list.shift()
    write(storage, QUEUE_KEY, list)
  }
  return { sent, dropped, left: list.length }
}

export function clearOffline (storage) {
  for (const key of [NEWS_KEY, QUEUE_KEY]) { try { storage.removeItem(key) } catch { /* ignore */ } }
}
