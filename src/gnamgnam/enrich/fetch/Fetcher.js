import { createHash } from 'crypto'

export { statusCode, cleanContentType, readCapped } from '../../../common/http/fetch.js'

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

/**
 * Statuses that are an answer, not a retryable failure. 999 is LinkedIn's
 * (and a few others') non-standard "request denied" for crawlers.
 */
export const REFUSALS = new Set([401, 403, 404, 410, 429, 451, 999])


export class Fetcher {
  canHandle (_ctx) { return false }
  async fetch (_url, _ctx) { throw new FetchError(`${this.constructor.name} does not implement fetch()`) }
}



export async function fetchJson (url, { userAgent, timeoutMs, headers = {} }) {
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

export function contentHash (text) {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}
