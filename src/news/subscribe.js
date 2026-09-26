import { NEWS_CONFIG } from '../../config/preferences.js'
import { readCapped } from '../common/http/fetch.js'
import { parseFeed, absoluteUrl } from './formats/feed.js'
import { discoverFeeds } from './formats/discover.js'
import { NewsError } from './NewsStore.js'

/**
 * What someone pasted → a feed to subscribe to. A feed URL is checked by
 * parsing it; a web page is searched for its feeds (the first one that
 * parses wins; the others are returned as alternatives).
 *
 * → { url, title, siteUrl, format, alternatives: [{ url, title }] }
 */

async function get (url, { fetchImpl, config }) {
  let response
  try {
    response = await fetchImpl(url, { headers: { 'User-Agent': config.userAgent, Accept: 'application/rss+xml, application/atom+xml, application/feed+json, text/html;q=0.8, */*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(config.requestTimeoutMs) })
  } catch (error) {
    throw new NewsError(`Could not fetch ${url}: ${error.cause?.code ?? error.message}`, 502)
  }
  if (!response.ok) throw new NewsError(`${url} answered HTTP ${response.status}`, 502)
  const { text } = await readCapped(response, config.maxBytes)
  return { text, url: response.url || url }
}

function tryParse (text, url) {
  try {
    return parseFeed(text, { url })
  } catch {
    return null
  }
}

export async function resolveFeed (input, { fetchImpl = fetch, config = NEWS_CONFIG } = {}) {
  const url = absoluteUrl(String(input ?? '').trim(), null)
  if (!url) throw new NewsError('Give an http(s) URL of a feed or of a web page that has one')
  const page = await get(url, { fetchImpl, config })
  const direct = tryParse(page.text, page.url)
  if (direct) return { url: page.url, title: direct.title, siteUrl: direct.siteUrl, format: direct.format, alternatives: [] }

  const candidates = discoverFeeds(page.text, page.url)
  for (const [i, candidate] of candidates.entries()) {
    let fetched
    try { fetched = await get(candidate.url, { fetchImpl, config }) } catch { continue }
    const feed = tryParse(fetched.text, fetched.url)
    if (feed) {
      const alternatives = candidates.filter((_, j) => j !== i).map(c => ({ url: c.url, title: c.title }))
      return { url: fetched.url, title: feed.title, siteUrl: feed.siteUrl ?? page.url, format: feed.format, alternatives }
    }
  }
  throw new NewsError(candidates.length ? `${url} links to feeds, but none of them could be read` : `No feed found at ${url}`, 422)
}
