import { NEWS_CONFIG } from '../../config/preferences.js'
import { readCapped, cleanContentType } from '../common/http/fetch.js'
import { hostOf } from '../common/links/urls.js'
import { isHtml } from './feedsOnPage.js'

/**
 * Look through bookmarked web pages for feeds, into the feed inbox
 * (bin/feed-scan.js). Politely: sites in parallel, one request at a time per
 * site with a pause between; at most `scanPagesPerHost` pages per site, and
 * none once a site has given a feed or already has a subscription or a
 * suggestion. Only the start of each page is read (feed links are in the
 * <head>).
 *
 * docs: bookmark documents ({ iri, url, contentType, linkStatus });
 * state: Map iri → { at, found } of pages already looked at (kept by the
 * caller, so a stopped scan carries on). → totals
 */

const SKIP_STATUS = new Set(['dead', 'blocked'])

export function scanPlan (docs, { state, knownHosts, rescan = false, config = NEWS_CONFIG }) {
  const byHost = new Map()
  const skip = config.discoverSkipHosts
  for (const doc of docs) {
    const host = hostOf(doc.url)
    if (!host || !/^https?:/i.test(doc.url) || !isHtml(doc.contentType) || SKIP_STATUS.has(doc.linkStatus)) continue
    if (knownHosts.has(host) || skip.some(h => host === h || host.endsWith(`.${h}`))) continue
    if (!byHost.has(host)) byHost.set(host, { tried: 0, found: false, todo: [] })
    const site = byHost.get(host)
    const seen = !rescan && state.get(doc.iri)
    if (seen) {
      site.tried++
      site.found ||= seen.found > 0
    } else {
      site.todo.push(doc)
    }
  }
  const plan = []
  for (const [host, site] of byHost) {
    if (site.found) continue
    const room = config.scanPagesPerHost - site.tried
    if (room > 0 && site.todo.length) plan.push({ host, docs: site.todo.slice(0, room) })
  }
  return plan
}

async function getPage (url, { fetchImpl, config }) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': config.userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(config.requestTimeoutMs) })
  if (!response.ok) return { status: `HTTP ${response.status}` }
  if (!isHtml(cleanContentType(response.headers))) {
    await response.body?.cancel?.().catch(() => {})
    return { status: 'not a web page' }
  }
  const { text } = await readCapped(response, config.scanMaxBytes)
  return { status: 'ok', html: text, url: response.url || url }
}

export async function scanBookmarks ({ docs, inbox, state, fetchImpl = fetch, config = NEWS_CONFIG, limit = Infinity, rescan = false, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date(), onResult = null, onPlan = null }) {
  const plan = scanPlan(docs, { state, knownHosts: await inbox.knownHosts(), rescan, config })
  let budget = limit
  for (const site of plan) {
    site.docs = site.docs.slice(0, Math.max(0, budget))
    budget -= site.docs.length
  }
  const queue = plan.filter(site => site.docs.length)
  onPlan?.({ sites: queue.length, pages: queue.reduce((n, s) => n + s.docs.length, 0) })
  const totals = { pages: 0, withFeeds: 0, added: 0, errors: 0 }
  const worker = async () => {
    for (let site = queue.shift(); site; site = queue.shift()) {
      for (const [i, doc] of site.docs.entries()) {
        if (i > 0) await sleep(config.perHostIntervalMs)
        let result
        try {
          const page = await getPage(doc.url, { fetchImpl, config })
          result = page.status === 'ok'
            ? { status: 'ok', ...(await inbox.addFromPage({ html: page.html, pageUrl: page.url, source: doc.iri })) }
            : { status: page.status, found: 0, added: [] }
        } catch (error) {
          result = { status: `error: ${error.cause?.code ?? error.message}`, found: 0, added: [] }
          totals.errors++
        }
        totals.pages++
        if (result.found) totals.withFeeds++
        totals.added += result.added.length
        state.set(doc.iri, { at: now().toISOString(), found: result.found })
        onResult?.(doc, result, totals)
        if (result.found) break // this site has given its feed
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(config.concurrency, queue.length) }, worker))
  return totals
}

export default scanBookmarks
