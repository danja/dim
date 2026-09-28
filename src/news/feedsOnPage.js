import { NEWS_CONFIG } from '../../config/preferences.js'
import { discoverFeeds } from './formats/discover.js'
import { hostOf } from '../common/links/urls.js'

/**
 * The feeds a bookmarked page offers, worth suggesting: its own feeds, not
 * comment feeds, and none from hosts whose every page has one of no general
 * interest (GitHub's per-repository commit feeds). → [{ url, title }]
 */

const COMMENTS = /\bcomments?\b/i

function isCommentFeed ({ url, title }) {
  const { pathname, search } = new URL(url)
  return COMMENTS.test(title ?? '') || /\/comments?(\/|$)|[?&]comments?=/i.test(pathname + search)
}

export function feedsOnPage (html, pageUrl, { skipHosts = NEWS_CONFIG.discoverSkipHosts, max = NEWS_CONFIG.discoverMaxPerPage } = {}) {
  const host = hostOf(pageUrl)
  if (!host || skipHosts.some(h => host === h || host.endsWith(`.${h}`))) return []
  return discoverFeeds(html, pageUrl)
    .filter(f => !isCommentFeed(f))
    .slice(0, max)
    .map(f => ({ url: f.url, title: f.title || null }))
}

/** Is this content type a web page? (Unknown counts: many servers don't say.) */
export function isHtml (contentType) {
  return !contentType || /html/i.test(contentType)
}

export default feedsOnPage
