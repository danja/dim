import { parseMentions } from './mentions.js'

/** URLs as a join key between facets. */

/** "https://www.Example.org/x" → "example.org" (null if not a URL). */
export function hostOf (url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** The http(s) URLs written in some Markdown, in order, once each. */
export function urlsIn (markdown) {
  return [...new Set(parseMentions(markdown).urls.filter(u => /^https?:\/\//i.test(u)))]
}

/** Link statuses worth a warning. */
export const BAD_LINK = new Set(['dead', 'blocked', 'error'])

/**
 * The URLs in some Markdown that a facet knows to be bad (registry.urlStatus).
 * → [{ url, status, href, label, archivedAt }]
 */
export async function badLinks (markdown, registry) {
  const out = []
  for (const url of urlsIn(markdown)) {
    const s = await registry.urlStatus(url)
    if (s && BAD_LINK.has(s.status)) out.push({ url, ...s })
  }
  return out
}
