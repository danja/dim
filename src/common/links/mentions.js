import { NAMESPACES } from '../rdf/NamespaceManager.js'

/**
 * References inside Markdown, and turning what someone typed or pasted into
 * the IRI of a DIM resource.
 *
 *   [[bookmark/slug]]      a resource by type and slug   → dim:bookmark/slug
 *   [[Some title]]         a resource by title (a facet resolves it)
 *   /r/bookmark/slug       the short resolver path, or any DIM page URL
 *   http://purl.org/stuff/dim/bookmark/slug   the IRI itself
 */

const { dim } = NAMESPACES
const TYPE_SLUG = /^([a-z][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9-]*)$/
const WIKI_LINK = /\[\[([^\]\n]{1,200})\]\]/g

export function iriFor (type, slug) {
  return `${dim}${type}/${slug}`
}

/** 'http://purl.org/stuff/dim/bookmark/x' → { type, slug } | null */
export function typeSlugOf (resourceIri) {
  const s = String(resourceIri ?? '')
  if (!s.startsWith(dim)) return null
  const m = s.slice(dim.length).match(TYPE_SLUG)
  return m ? { type: m[1], slug: m[2] } : null
}

/** Strip fenced and inline code so references inside code are not links. */
function withoutCode (markdown) {
  return String(markdown ?? '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
}

/** → { refs: [{ type, slug }], titles: [string], urls: [string] } */
export function parseMentions (markdown) {
  const text = withoutCode(markdown)
  const refs = []
  const titles = []
  for (const [, inner] of text.matchAll(WIKI_LINK)) {
    const value = inner.trim()
    const m = value.match(TYPE_SLUG)
    if (m) refs.push({ type: m[1], slug: m[2] })
    else if (value) titles.push(value)
  }
  const urls = [...text.matchAll(/(?:https?:\/\/[^\s)<>\]]+|(?<![\w/])\/r\/[a-z][a-z0-9-]*\/[A-Za-z0-9-]+)/g)].map(m => m[0].replace(/[.,;:!?]+$/, ''))
  return { refs, titles, urls }
}

/**
 * What someone typed as a link target → an IRI, or null.
 * `registry` (a FacetRegistry) maps page paths and bookmarked URLs back to
 * resources; `origin` is this server's own origin (config site.origin).
 */
export function toIri (input, { registry = null, origin = null } = {}) {
  let value = String(input ?? '').trim()
  if (!value) return null
  const wiki = value.match(/^\[\[(.+)\]\]$/)
  if (wiki) value = wiki[1].trim()
  const ts = value.match(TYPE_SLUG)
  if (ts) return iriFor(ts[1], ts[2])
  if (value.startsWith(dim)) return typeSlugOf(value) ? value : null

  let path = null
  if (value.startsWith('/') && !value.startsWith('//')) path = value
  else if (origin && value.startsWith(origin + '/')) path = value.slice(origin.length)
  if (path) {
    path = path.split(/[?#]/)[0].replace(/\.(ttl|json)$/, '')
    const r = path.match(/^\/r\/([a-z][a-z0-9-]*)\/([A-Za-z0-9-]+)$/)
    if (r) return iriFor(r[1], r[2])
    return registry?.iriFromPath(path) ?? null
  }

  if (/^https?:\/\//.test(value)) {
    // A bookmarked URL means the bookmark; anything else is linked as itself.
    return registry?.iriFromUrl(value) ?? value
  }
  return null
}

/** Markdown → IRIs it mentions. Titles go through registry.resolveTitle. */
export async function resolveMentions (markdown, { registry = null, origin = null } = {}) {
  const { refs, titles, urls } = parseMentions(markdown)
  const out = refs.map(r => iriFor(r.type, r.slug))
  for (const url of urls) {
    const found = toIri(url, { registry, origin })
    if (found && typeSlugOf(found)) out.push(found)
  }
  for (const title of titles) {
    const found = await registry?.resolveTitle?.(title)
    if (found) out.push(found)
  }
  return [...new Set(out)]
}
