import logger from 'loglevel'
import { NEWS_CONFIG } from '../../config/preferences.js'
import { readCapped, statusCode } from '../common/http/fetch.js'
import { parseFeed } from './formats/feed.js'
import { shouldPark } from './parking.js'

/**
 * Polls feeds politely: conditional GET (ETag / Last-Modified), an honest
 * user-agent, one request at a time per host with a pause between, a few
 * hosts in parallel, and a back-off that doubles after each failure.
 * 410 Gone stops polling a feed; 401/403/404/451 are recorded as refusals.
 */

const ACCEPT = 'application/rss+xml, application/atom+xml, application/feed+json, application/rdf+xml;q=0.9, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5'
const REFUSED = new Set([401, 403, 404, 451, 999])
const minutes = n => n * 60000

export class Poller {
  constructor ({ store, config = NEWS_CONFIG, fetchImpl = fetch, now = () => new Date(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    Object.assign(this, { store, config, fetchImpl, now, sleep })
    this.running = null
  }

  /** When to poll again: the interval, doubled per failure, or Retry-After. */
  nextPoll (failures, retryAfter = null) {
    const wait = Math.min(minutes(this.config.pollIntervalMinutes) * 2 ** Math.min(failures, 6), minutes(this.config.maxBackoffMinutes))
    const seconds = Number(retryAfter)
    const asked = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
    return new Date(this.now().getTime() + Math.max(wait, asked)).toISOString()
  }

  isDue (feed) {
    return !feed.parked && feed.status !== 'gone' && (!feed.nextPoll || feed.nextPoll <= this.now().toISOString())
  }

  /**
   * One feed, now. refetch: ask for the whole feed even if unchanged (to
   * fill in what earlier polls missed). → { status, fresh, error? }
   */
  async pollFeed (feed, { refetch = false } = {}) {
    const at = this.now().toISOString()
    const headers = { 'User-Agent': this.config.userAgent, Accept: ACCEPT }
    if (feed.etag && !refetch) headers['If-None-Match'] = feed.etag
    if (feed.lastModified && !refetch) headers['If-Modified-Since'] = feed.lastModified
    const fail = async (status, message, httpStatus = null, retryAfter = null) => {
      const failures = (feed.failures ?? 0) + 1
      const parked = Boolean(feed.parked) || shouldPark({ status, failures }, this.config.parkAfterFailures)
      const newlyParked = parked && !feed.parked
      await this.store.recordPoll(feed, { status, lastError: message, httpStatus, lastPolled: at, failures, parked, nextPoll: status === 'gone' ? null : this.nextPoll(failures, retryAfter) })
      return { status, fresh: 0, error: message, ...(newlyParked ? { parked: true } : {}) }
    }

    let response
    try {
      response = await this.fetchImpl(feed.url, { headers, redirect: 'follow', signal: AbortSignal.timeout(this.config.requestTimeoutMs) })
    } catch (error) {
      return fail('error', `request failed: ${error.cause?.code ?? error.message}`)
    }
    const code = statusCode(response.status)
    if (code === 304) {
      await this.store.recordPoll(feed, { status: 'not-modified', lastError: null, httpStatus: 304, lastPolled: at, failures: 0, parked: false, nextPoll: this.nextPoll(0) })
      return { status: 'not-modified', fresh: 0 }
    }
    if (code === 410) return fail('gone', 'HTTP 410: the feed has been removed', 410)
    if (REFUSED.has(code)) return fail('refused', `HTTP ${code}`, code)
    if (!response.ok) return fail('error', `HTTP ${code}`, code, response.headers.get('retry-after'))

    let parsed
    try {
      const { text } = await readCapped(response, this.config.maxBytes)
      parsed = parseFeed(text, { url: response.url || feed.url })
    } catch (error) {
      return fail('error', error.message, code)
    }

    const newest = parsed.items
      .slice().sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''))
      .slice(0, this.config.maxItemsPerPoll)
    const first = !feed.lastPolled
    let fresh
    try {
      fresh = await this.store.addItems(feed, newest)
      if (first && fresh.length) {
        // Subscribing shouldn't bury you: older items start as read.
        const cutoff = new Date(this.now().getTime() - this.config.firstPollUnreadDays * 86400000).toISOString()
        await this.store.setFlags(fresh.filter(i => (i.published ?? i.firstSeen) < cutoff), { read: true })
      }
    } catch (error) {
      // Recorded, so the feed backs off instead of failing on every tick.
      return fail('error', `storing items failed: ${error.message}`, code)
    }
    const learnt = {}
    if (feed.title === feed.url && parsed.title) learnt.title = parsed.title
    if (!feed.siteUrl && parsed.siteUrl) learnt.siteUrl = parsed.siteUrl
    if (Object.keys(learnt).length) await this.store.updateFeed(feed, learnt, 'poller')
    await this.store.recordPoll(feed, {
      status: 'ok',
      format: parsed.format,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
      httpStatus: code,
      lastError: null,
      lastPolled: at,
      failures: 0,
      parked: false,
      nextPoll: this.nextPoll(0)
    })
    return { status: 'ok', fresh: fresh.length }
  }

  /**
   * Every due feed; with force, every feed due or not. Parked feeds are left
   * out of both, but polled when named in `feeds`. Hosts in parallel, each
   * host's feeds one after another. Only one run at a time; a second call
   * while one runs gets the running one.
   */
  pollDue ({ feeds = null, force = false, refetch = false, limit = Infinity, onResult = null } = {}) {
    if (this.running) return this.running
    this.running = this.#run({ feeds, force, refetch, limit, onResult }).finally(() => { this.running = null })
    return this.running
  }

  async #run ({ feeds, force, refetch, limit, onResult }) {
    const all = feeds ?? await this.store.feedList()
    const due = (feeds ? all : all.filter(f => !f.parked && (force || this.isDue(f)))).slice(0, limit)
    const byHost = new Map()
    for (const feed of due) {
      let host = 'unknown'
      try { host = new URL(feed.url).host } catch { /* keep */ }
      if (!byHost.has(host)) byHost.set(host, [])
      byHost.get(host).push(feed)
    }
    const queue = [...byHost.values()]
    const totals = { polled: 0, fresh: 0, ok: 0, 'not-modified': 0, error: 0, refused: 0, gone: 0, parked: 0 }
    const worker = async () => {
      for (let group = queue.shift(); group; group = queue.shift()) {
        for (const [i, feed] of group.entries()) {
          if (i > 0) await this.sleep(this.config.perHostIntervalMs)
          let result
          try {
            result = await this.pollFeed(feed, { refetch })
          } catch (error) {
            logger.error(`[news] ${feed.url}:`, error)
            result = { status: 'error', fresh: 0, error: error.message }
          }
          totals.polled++
          totals.fresh += result.fresh
          totals[result.status]++
          if (result.parked) totals.parked++
          onResult?.(feed, result)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.config.concurrency, queue.length) }, worker))
    return totals
  }
}

export default Poller
