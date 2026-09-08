import { createHash } from 'crypto'
import { HARVEST_CONFIG, ENRICH_CONFIG } from '../../config/preferences.js'

/**
 * Pluggable fetchers for the second-pass enricher (docs/enricher.md).
 *
 * A fetcher retrieves one URL and returns a plain record. Specialised
 * fetchers (GitHub API, arXiv API, Wikipedia summary API) go first in the
 * registry; HttpFetcher is the default that handles anything.
 */

export class FetchError extends Error {
  constructor (message, { url = null, status = null, cause = null } = {}) {
    super(message)
    this.name = 'FetchError'
    this.url = url
    this.status = status
    if (cause) this.cause = cause
  }
}

/** Statuses that are an answer, not a retryable failure. */
export const REFUSALS = new Set([401, 403, 404, 410, 429, 451])

export class Fetcher {
  canHandle (_ctx) { return false }
  async fetch (_url, _ctx) { throw new FetchError(`${this.constructor.name} does not implement fetch()`) }
}

function cleanContentType (headers) {
  const raw = headers.get?.('content-type') ?? headers['content-type'] ?? null
  return raw?.split(';')[0]?.trim() || null
}

async function readCapped (response, maxBytes) {
  const buffer = Buffer.from(await response.arrayBuffer())
  const sliced = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer
  return { text: sliced.toString('utf8'), truncated: buffer.length > maxBytes }
}

/** Default fetcher: one polite GET, honest user-agent, paced requests. */
export class HttpFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, requestIntervalMs = HARVEST_CONFIG.requestIntervalMs, requestTimeoutMs = HARVEST_CONFIG.requestTimeoutMs, maxBytes = ENRICH_CONFIG.fetchMaxBytes } = {}) {
    super()
    this.userAgent = userAgent
    this.requestIntervalMs = requestIntervalMs
    this.requestTimeoutMs = requestTimeoutMs
    this.maxBytes = maxBytes
    this.lastRequestAt = 0
  }

  canHandle (_ctx) { return true }

  async #pace () {
    const wait = this.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  async fetch (url) {
    await this.#pace()
    let response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'text/html,application/xhtml+xml,*/*' },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
        redirect: 'follow'
      })
    } catch (error) {
      throw new FetchError(`GET failed: ${error.message}`, { url, cause: error })
    }
    const contentType = cleanContentType(response.headers)
    if (REFUSALS.has(response.status)) {
      return { url: response.url || url, body: null, contentType, httpStatus: response.status, refused: true }
    }
    try {
      const { text } = await readCapped(response, this.maxBytes)
      return { url: response.url || url, body: text, contentType, httpStatus: response.status, refused: false }
    } catch (error) {
      throw new FetchError(`Body unreadable: ${error.message}`, { url, status: response.status, cause: error })
    }
  }
}

async function fetchJson (url, { userAgent, timeoutMs, headers = {} }) {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent, Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!response.ok) {
    return { ok: false, status: response.status }
  }
  try {
    return { ok: true, status: response.status, json: await response.json() }
  } catch {
    return { ok: false, status: response.status }
  }
}

/** github.com/<owner>/<repo> → repo metadata + topics as plain text. */
export class GithubApiFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000 } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
  }

  canHandle ({ url }) {
    return /^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url)
  }

  async fetch (url) {
    const api = url.replace(/\/$/, '').replace('https://github.com/', 'https://api.github.com/repos/')
    let result
    try {
      result = await fetchJson(api, { userAgent: this.userAgent, timeoutMs: this.timeoutMs, headers: { Accept: 'application/vnd.github+json' } })
    } catch (error) {
      throw new FetchError(`GitHub API failed: ${error.message}`, { url, cause: error })
    }
    if (!result.ok) return { url, body: null, contentType: null, httpStatus: result.status, refused: REFUSALS.has(result.status) }
    const j = result.json
    const lines = [
      `${j.full_name ?? ''} — ${j.description ?? 'no description'}`,
      j.language ? `Language: ${j.language}` : null,
      j.stargazers_count != null ? `Stars: ${j.stargazers_count}` : null,
      (j.topics?.length) ? `Topics: ${j.topics.join(', ')}` : null,
      j.homepage ? `Homepage: ${j.homepage}` : null
    ].filter(Boolean)
    return {
      url,
      body: lines.join('\n'),
      contentType: 'text/plain',
      httpStatus: 200,
      refused: false,
      title: j.full_name ?? null,
      description: j.description ?? null
    }
  }
}

/** arxiv.org/abs/<id> → title + abstract via the arXiv API. */
export class ArxivFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000 } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
  }

  canHandle ({ url }) {
    return /arxiv\.org\//.test(url)
  }

  async fetch (url) {
    const id = (url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9a-z+./-]+)/i)?.[1] ?? '').replace(/\.pdf$/i, '').replace(/v\d+$/, '')
    if (!id) return { url, body: null, contentType: null, httpStatus: null, refused: false }
    let response
    try {
      response = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs)
      })
    } catch (error) {
      throw new FetchError(`arXiv API failed: ${error.message}`, { url, cause: error })
    }
    if (!response.ok) return { url, body: null, contentType: null, httpStatus: response.status, refused: REFUSALS.has(response.status) }
    const xml = await response.text()
    const title = xml.match(/<title>([\s\S]*?)<\/title>\s*<id>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
    const summary = xml.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
    const authors = [...xml.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map(m => m[1].trim())
    if (!title && !summary) return { url, body: null, contentType: null, httpStatus: response.status, refused: false }
    const body = [`${title ?? 'arXiv paper'}${authors.length ? ` — ${authors.join(', ')}` : ''}`, summary].filter(Boolean).join('\n\n')
    return { url, body, contentType: 'text/plain', httpStatus: 200, refused: false, title, description: summary }
  }
}

/** *.wikipedia.org/wiki/<title> → REST summary extract as plain text. */
export class WikipediaFetcher extends Fetcher {
  constructor ({ userAgent = HARVEST_CONFIG.userAgent, timeoutMs = 15000 } = {}) {
    super()
    this.userAgent = userAgent
    this.timeoutMs = timeoutMs
  }

  canHandle ({ url }) {
    return /\.wikipedia\.org\/wiki\//.test(url)
  }

  async fetch (url) {
    const m = url.match(/https?:\/\/([a-z-]+)\.wikipedia\.org\/wiki\/([^#?]+)/)
    if (!m) return { url, body: null, contentType: null, httpStatus: null, refused: false }
    const api = `https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`
    let result
    try {
      result = await fetchJson(api, { userAgent: this.userAgent, timeoutMs: this.timeoutMs })
    } catch (error) {
      throw new FetchError(`Wikipedia API failed: ${error.message}`, { url, cause: error })
    }
    if (!result.ok) return { url, body: null, contentType: null, httpStatus: result.status, refused: REFUSALS.has(result.status) }
    const body = [result.json.title, result.json.extract].filter(Boolean).join('\n\n') || null
    return {
      url,
      body,
      contentType: body ? 'text/plain' : null,
      httpStatus: 200,
      refused: false,
      title: result.json.title ?? null,
      description: result.json.extract ?? null
    }
  }
}

export function contentHash (text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

export default Fetcher
