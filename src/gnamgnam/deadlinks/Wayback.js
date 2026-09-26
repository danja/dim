import fs from 'fs'
import path from 'path'
import { HARVEST_CONFIG } from '../../../config/preferences.js'
import { NAMESPACES } from '../../common/rdf/NamespaceManager.js'
import { iri } from '../../common/store/SPARQLHelper.js'

/**
 * Wayback Machine lookups for dead bookmarks, via the public availability
 * API (https://archive.org/help/wayback_api.php). Polite: one request per
 * HARVEST_CONFIG.requestIntervalMs, honest user-agent. Answers — including
 * "no snapshot" — are cached, so a re-ingest can restore schema:archivedAt
 * without asking again.
 */

export const ARCHIVED_AT = `${NAMESPACES.schema}archivedAt`

export function availabilityUrl (url) {
  return `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`
}

/** API reply → { archivedUrl, timestamp } for the closest good snapshot, or null. */
export function parseAvailability (json) {
  const closest = json?.archived_snapshots?.closest
  if (!closest?.available || !closest.url) return null
  if (closest.status && !/^[23]\d\d$/.test(String(closest.status))) return null
  const archivedUrl = String(closest.url).replace(/^http:\/\//, 'https://')
  if (!archivedUrl.startsWith('https://web.archive.org/')) return null
  return { archivedUrl, timestamp: closest.timestamp ?? null }
}

/** Replace a bookmark's schema:archivedAt in its graph. */
export function buildArchivePatchQuery (graph, bookmarkIri, archivedUrl) {
  const g = iri(graph)
  const s = iri(bookmarkIri)
  const p = iri(ARCHIVED_AT)
  return `DELETE WHERE { GRAPH ${g} { ${s} ${p} ?old } } ;
INSERT DATA { GRAPH ${g} { ${s} ${p} ${iri(archivedUrl)} . } }`
}

export class WaybackClient {
  constructor ({
    cachePath,
    userAgent = HARVEST_CONFIG.userAgent,
    requestIntervalMs = HARVEST_CONFIG.requestIntervalMs,
    timeoutMs = HARVEST_CONFIG.requestTimeoutMs,
    fetchImpl = fetch
  }) {
    if (!cachePath) throw new Error('WaybackClient needs a cachePath')
    this.cachePath = cachePath
    this.userAgent = userAgent
    this.requestIntervalMs = requestIntervalMs
    this.timeoutMs = timeoutMs
    this.fetchImpl = fetchImpl
    this.lastRequestAt = 0
    this.cache = null
  }

  async #load () {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.promises.readFile(this.cachePath, 'utf8'))
    } catch {
      this.cache = { entries: {} }
    }
    this.cache.entries ??= {}
    return this.cache
  }

  async #save () {
    await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true })
    await fs.promises.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2))
  }

  async #pace () {
    const wait = this.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  /**
   * → { archivedUrl, timestamp, fromCache } or { archivedUrl: null, fromCache }.
   * Network failures throw and are not cached, so a later run retries them.
   */
  async lookup (url, { force = false } = {}) {
    const cache = await this.#load()
    if (!force && url in cache.entries) return { ...cache.entries[url], fromCache: true }
    await this.#pace()
    const response = await this.fetchImpl(availabilityUrl(url), {
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) throw new Error(`Wayback API HTTP ${response.status}`)
    const found = parseAvailability(await response.json())
    cache.entries[url] = { archivedUrl: found?.archivedUrl ?? null, timestamp: found?.timestamp ?? null, checkedAt: new Date().toISOString() }
    await this.#save()
    return { ...cache.entries[url], fromCache: false }
  }
}

export default WaybackClient
