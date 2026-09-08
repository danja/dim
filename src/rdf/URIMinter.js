import { createHash } from 'crypto'
import { NAMESPACES } from './NamespaceManager.js'

/**
 * IRI minting for DIM. Adapted from plugin-universe URIMinter.
 * IRIs live under http://purl.org/stuff/dim/ so identity survives hosting moves.
 * Bookmark identity is the canonical URL — one URL, one bookmark.
 */

const TYPE_PATHS = Object.freeze({
  bookmark: 'bookmark',
  concept: 'concept',
  person: 'person',
  retrieval: 'retrieval'
})

const SEPARATOR = ''

export class URIMintError extends Error {
  constructor (message) {
    super(message)
    this.name = 'URIMintError'
  }
}

export function slugify (text) {
  if (typeof text !== 'string') {
    throw new URIMintError(`Cannot slugify a ${typeof text}`)
  }
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  if (!slug) {
    throw new URIMintError(`Slug is empty after normalising: ${JSON.stringify(text)}`)
  }
  return slug
}

/** Canonicalise a URL for identity: lowercase host, drop trailing slash, drop fragment. */
export function canonicalUrl (raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new URIMintError(`Not a URL: ${JSON.stringify(raw)}`)
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new URIMintError(`Only http(s) URLs are bookmark identity, got ${url.protocol}`)
  }
  url.hash = ''
  url.hostname = url.hostname.toLowerCase()
  // Strip trailing slash on any path (except a bare '?' search) so
  // 'https://github.com/foo/bar' and '.../bar/' share one identity.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  let s = url.toString()
  // Drop trailing slash on bare origins/paths for dedup stability.
  if (s.endsWith('/') && url.pathname === '/' && !url.search) s = s.slice(0, -1)
  return s
}

export class URIMinter {
  constructor (base = NAMESPACES.dim) {
    if (!base.endsWith('/')) throw new URIMintError(`Base IRI must end with "/": ${base}`)
    this.base = base
  }

  mint (type, label, identity) {
    const typePath = TYPE_PATHS[type]
    if (!typePath) {
      throw new URIMintError(`Unknown IRI type "${type}". Known: ${Object.keys(TYPE_PATHS).join(', ')}`)
    }
    if (!Array.isArray(identity) || identity.length === 0) {
      throw new URIMintError(`Minting a ${type} IRI needs a non-empty identity tuple`)
    }
    if (identity.some(part => part === null || part === undefined || part === '')) {
      throw new URIMintError(
        `Identity tuple for ${type} "${label}" contains an empty part: ${JSON.stringify(identity)}.`
      )
    }
    const canonical = identity.map(String).join(SEPARATOR)
    const hash = createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 8)
    return `${this.base}${typePath}/${slugify(label)}-${hash}`
  }

  /** One URL = one bookmark. The readable part derives from the URL alone,
   * so re-harvesting with different link text mints the same IRI. */
  mintBookmark ({ url }) {
    if (!url) throw new URIMintError('A bookmark needs a URL to mint an IRI')
    const canonical = canonicalUrl(url)
    const u = new URL(canonical)
    const label = `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 80)
    return this.mint('bookmark', label, [canonical])
  }

  mintConcept ({ slug }) {
    if (!slug) throw new URIMintError('A concept needs a slug')
    return `${this.base}concept/${slug}`
  }
}

export default URIMinter
