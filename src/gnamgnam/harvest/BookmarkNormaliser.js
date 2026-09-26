import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'
import { catalogueFromUrl, cleanCatalogue } from '../Catalogue.js'
import { statusCode } from '../enrich/fetch/Fetcher.js'

/**
 * First-pass bookmark classification. Pure heuristics over URL + headers, no
 * content fetch required — this is the "determine the type of the target" step
 * from docs/plan.md. SKOS concepts live under dim:concept/<slug>.
 */

const dim = NAMESPACES.dim

export class NormaliseError extends Error {
  constructor (message) {
    super(message)
    this.name = 'NormaliseError'
  }
}

export function normaliseUrl (raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/** Host + path heuristics → SKOS concept IRIs. Ordered, most specific first. */
export function classifyUrl (rawUrl, { contentType = null } = {}) {
  const types = []
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return [`${dim}concept/unknown`]
  }
  const host = url.hostname.toLowerCase()
  const path = url.pathname.toLowerCase()

  const add = (slug) => types.push(`${dim}concept/${slug}`)

  if (host === 'github.com') {
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length >= 2) add('github-repo')
    else add('github')
    if (/\.(md|ttl|json|pdf)$/.test(path) || path.includes('/blob/') || path.includes('/tree/')) add('github-file')
  }
  if (host === 'arxiv.org' || rawUrl.includes('arxiv')) add('arxiv-paper')
  if (host.endsWith('wikipedia.org')) add('wikipedia-article')
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.soundcloud.com' || host === 'soundcloud.com' || host.includes('bandcamp.com')) add('audio')
  if (host === 'vimeo.com' || path.endsWith('.mp4')) add('video')
  if (path.endsWith('.pdf')) add('pdf')
  if (/docs\.google\.com|drive\.google\.com/.test(host + path)) add('docs')
  if (/reddit\.com|llllllll\.co|lines/.test(host)) add('forum')
  if (/amazon\.|etsy\.com|ko-fi\.com|tindie\.com/.test(host)) add('shop')
  if (/github\.io|readthedocs|.*docs\..*/.test(host) || path.includes('/docs/')) add('docs')
  if (/\.juce\.com|developer\.|spec|w3\.org|ietf/.test(host + path)) add('spec')

  if (contentType) {
    if (contentType.includes('pdf')) add('pdf')
    else if (contentType.includes('video')) add('video')
    else if (contentType.includes('audio')) add('audio')
  }

  if (types.length === 0) {
    // Fallback by evident domain family.
    if (/github|gitlab|codeberg|sourcehut/.test(host)) add('code')
    else add('webpage')
  }
  return [...new Set(types)]
}

export function domainOf (rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** Harvester row → normalised bookmark record consumed by serialiser + embeddings. */
export function normaliseBookmark (raw) {
  if (!raw.url) throw new NormaliseError('A bookmark record needs a URL')
  const url = normaliseUrl(raw.url)
  if (!url) throw new NormaliseError(`Not an http(s) URL: ${JSON.stringify(raw.url)}`)
  const bookmarkTypes = raw.bookmarkTypes?.length
    ? [...new Set(raw.bookmarkTypes)]
    : classifyUrl(url, { contentType: raw.contentType ?? null })
  return {
    url,
    linkText: (raw.linkText ?? '').trim() || null,
    title: raw.title?.trim() || null,
    description: raw.description?.trim()?.slice(0, 2000) || null,
    summary: raw.summary?.trim()?.slice(0, 1000) || null,
    summaryModel: raw.summaryModel ?? null,
    summarisedAt: raw.summarisedAt ?? null,
    keywords: [...new Set((raw.keywords ?? []).map(t => String(t).trim().toLowerCase()).filter(t => t.length > 1))].sort().slice(0, 12),
    markdown: raw.markdown?.trim()?.slice(0, 4000) || null,
    contentHash: raw.contentHash ?? null,
    contentLength: typeof raw.contentLength === 'number' ? raw.contentLength : null,
    fetchStatus: statusCode(raw.fetchStatus),
    contentType: raw.contentType ?? null,
    httpStatus: statusCode(raw.httpStatus),
    retrievedAt: raw.retrievedAt ?? null,
    domain: domainOf(url),
    context: raw.context?.trim()?.slice(0, 500) || null,
    sourceLine: raw.sourceLine ?? null,
    bookmarkTypes,
    tags: [...new Set((raw.tags ?? []).map(t => String(t).trim().toLowerCase()).filter(Boolean))].sort(),
    concepts: [...new Set(raw.concepts ?? [])],
    // URL-derived details first; anything the caller already knows wins.
    catalogue: { ...catalogueFromUrl(url), ...cleanCatalogue(raw.catalogue) }
  }
}

export default normaliseBookmark
