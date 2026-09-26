import { ENRICH_CONFIG } from '../../../config/preferences.js'

/**
 * Pluggable extractors for the second-pass enricher (docs/enricher.md).
 *
 * An extractor turns a fetched body into clean text. Regex-based and
 * dependency-free by design: HTML here is hostile and varied, and a
 * readability-grade extraction is explicitly not required for v1 — the
 * summariser only needs the main prose. Raw text is capped and cached to
 * disk by CacheWriter, never stored in SPARQL.
 */

export class ExtractError extends Error {
  constructor (message, { url = null, cause = null } = {}) {
    super(message)
    this.name = 'ExtractError'
    this.url = url
    if (cause) this.cause = cause
  }
}

export class Extractor {
  canHandle (_ctx) { return false }
  async extract (_fetched, _ctx) { throw new ExtractError(`${this.constructor.name} does not implement extract()`) }
}

export function cleanText (s, max = ENRICH_CONFIG.extractMaxChars) {
  const cleaned = String(s ?? '')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return (cleaned.slice(0, max) || null)
}

function decodeEntities (s) {
  return s
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
}

function stripTags (html) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
}

export function extractTitle (html) {
  const m = html.match(/<title[^>]*>([^<]{1,500})<\/title>/i)
  if (m) return cleanText(decodeEntities(m[1]), 300)
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,500})/i)
  if (og) return cleanText(decodeEntities(og[1]), 300)
  return null
}

export function extractMetaDescription (html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,2000})/i)
  if (m) return cleanText(decodeEntities(m[1]))
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,2000})/i)
  if (og) return cleanText(decodeEntities(og[1]))
  return null
}

/** text/html → main prose: article/main preferred, paragraphs + headings. */
export class HtmlExtractor extends Extractor {
  canHandle ({ contentType, fetched }) {
    if (contentType?.includes('html')) return true
    return typeof fetched?.body === 'string' && /<\s*html[\s>]/i.test(fetched.body.slice(0, 2000))
  }

  async extract (fetched) {
    const html = fetched.body ?? ''
    const title = fetched.title ?? extractTitle(html)
    const description = fetched.description ?? extractMetaDescription(html)
    const dechromed = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    const region =
      dechromed.match(/<article[\s\S]*?<\/article>/i)?.[0] ??
      dechromed.match(/<main[\s\S]*?<\/main>/i)?.[0] ??
      dechromed
    const blocks = [...region.matchAll(/<(p|h1|h2|h3|li|blockquote)[^>]*>([\s\S]{20,4000}?)<\/\1>/gi)]
      .map(m => cleanText(stripTags(m[2]), 2000))
      .filter(Boolean)
    const text = cleanText(blocks.join('\n\n')) ?? cleanText(stripTags(region))
    if (!text) return null
    return { text, title, description }
  }
}

/** Already-plain bodies (site API fetchers) pass through with cleanup. */
export class PlainTextExtractor extends Extractor {
  canHandle ({ contentType }) {
    return contentType === 'text/plain' || contentType === 'application/json' || contentType === 'application/atom+xml'
  }

  async extract (fetched) {
    const text = cleanText(fetched.body)
    if (!text) return null
    return { text, title: fetched.title ?? null, description: fetched.description ?? null }
  }
}

/** github-repo bookmark type: readme-flavoured markdown → plain text. */
export class GithubExtractor extends Extractor {
  canHandle ({ bookmarkType }) {
    return (bookmarkType ?? []).some(t => t.endsWith('/github-repo') || t.endsWith('/github-file'))
  }

  async extract (fetched) {
    const body = fetched.body ?? ''
    const text = cleanText(
      body
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#>*_`[\]()!-]/g, ' ')
    )
    if (!text) return null
    return { text, title: fetched.title ?? null, description: fetched.description ?? null }
  }
}

/** application/pdf: stub — binary text is out of scope for v1. */
export class PdfExtractor extends Extractor {
  canHandle ({ contentType }) {
    return contentType === 'application/pdf'
  }

  async extract (_fetched) {
    return null
  }
}

/** Last resort: never empty when the fetch produced anything usable. */
export class FallbackExtractor extends Extractor {
  canHandle (_ctx) { return true }

  async extract (fetched) {
    const title = fetched.title ?? null
    const description = fetched.description ?? null
    const fromBody = fetched.body && !/<\s*html[\s>]/i.test(fetched.body.slice(0, 500))
      ? cleanText(stripTags(fetched.body), 2000)
      : null
    const text = cleanText([title, description, fromBody].filter(Boolean).join('\n\n'), 2000)
    if (!text) return null
    return { text, title, description }
  }
}

export default Extractor
