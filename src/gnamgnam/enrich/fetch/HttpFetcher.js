import { HARVEST_CONFIG, ENRICH_CONFIG } from '../../../../config/preferences.js'
import { Fetcher, FetchError, REFUSALS, cleanContentType, readCapped } from './Fetcher.js'

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
