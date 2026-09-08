import fs from 'fs'
import path from 'path'
import logger from 'loglevel'
import { Harvester, HarvestError } from './Harvester.js'
import { parseWorkflowyFile, deduplicate } from './WorkflowyParser.js'
import { normaliseBookmark, classifyUrl, domainOf } from './BookmarkNormaliser.js'
import { HARVEST_CONFIG } from '../../config/preferences.js'
import Config from '../Config.js'

/**
 * Bookmark harvester: the versatile retrieval agent's first pass from
 * docs/plan.md. GETs each link from data/workflowy.md, determines the target
 * type from URL + response headers + <title>, and emits bookmark records.
 *
 * Politeness follows HttpSource rules: honest user-agent, paced requests, a
 * refusal (401/403/404/410/429/451) is an answer recorded on the bookmark
 * rather than retried around.
 */

const REFUSALS = new Set([401, 403, 404, 410, 429, 451])

function cleanText (s, max = 2000) {
  return s.replace(/\s+/g, ' ').trim().slice(0, max) || null
}

function extractTitle (html) {
  const m = html.match(/<title[^>]*>([^<]{1,500})<\/title>/i)
  if (m) return cleanText(m[1].replace(/&#?\w+;/g, ' '), 300)
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,500})/i)
  if (og) return cleanText(og[1], 300)
  return null
}

function extractDescription (html) {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,2000})/i)
  if (m) return cleanText(m[1])
  const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,2000})/i)
  if (og) return cleanText(og[1])
  return null
}

export class BookmarkHarvester extends Harvester {
  constructor ({ workflowyFile = 'data/workflowy.md', cachePath = 'data/cache/retrieval.json', fetchLive = true } = {}) {
    super({
      id: 'workflowy',
      kind: 'source',
      licence: 'CC0-1.0',
      derivedFrom: 'file:data/workflowy.md'
    })
    this.workflowyFile = path.isAbsolute(workflowyFile) ? workflowyFile : path.join(Config.projectRoot, workflowyFile)
    this.cachePath = path.isAbsolute(cachePath) ? cachePath : path.join(Config.projectRoot, cachePath)
    this.fetchLive = fetchLive
    this.lastRequestAt = 0
    this.cache = null
  }

  async #pace () {
    const wait = HARVEST_CONFIG.requestIntervalMs - (Date.now() - this.lastRequestAt)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastRequestAt = Date.now()
  }

  async #loadCache () {
    if (this.cache) return this.cache
    try {
      this.cache = JSON.parse(await fs.promises.readFile(this.cachePath, 'utf8'))
    } catch {
      this.cache = { retrieved: {} }
    }
    this.cache.retrieved ??= {}
    return this.cache
  }

  async #saveCache () {
    await fs.promises.mkdir(path.dirname(this.cachePath), { recursive: true })
    await fs.promises.writeFile(this.cachePath, JSON.stringify(this.cache, null, 2))
  }

  async probe (url) {
    const cache = await this.#loadCache()
    const hit = cache.retrieved[url]
    if (hit && (Date.now() - new Date(hit.retrievedAt).getTime()) < 7 * 24 * 3600 * 1000) {
      return hit
    }
    if (!this.fetchLive) {
      return { url, httpStatus: null, contentType: null, title: null, description: null, retrievedAt: new Date().toISOString(), fromCache: true }
    }
    await this.#pace()
    let response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': HARVEST_CONFIG.userAgent, Accept: 'text/html,application/xhtml+xml,*/*' },
        signal: AbortSignal.timeout(HARVEST_CONFIG.requestTimeoutMs),
        redirect: 'follow'
      })
    } catch (error) {
      const result = { url, httpStatus: null, contentType: null, title: null, description: `fetch failed: ${error.message}`, retrievedAt: new Date().toISOString() }
      cache.retrieved[url] = result
      await this.#saveCache()
      return result
    }
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? null
    if (REFUSALS.has(response.status)) {
      const result = { url, httpStatus: response.status, contentType, title: null, description: `refused: HTTP ${response.status} — recorded, not retried`, retrievedAt: new Date().toISOString() }
      cache.retrieved[url] = result
      await this.#saveCache()
      return result
    }
    let title = null
    let description = null
    if (contentType?.includes('html') || !contentType) {
      try {
        const text = (await response.text()).slice(0, 200000)
        title = extractTitle(text)
        description = extractDescription(text)
      } catch (error) {
        description = `body unreadable: ${error.message}`
      }
    }
    // GitHub API enrichment for repos: name + description without scraping HTML.
    if (/^https?:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(url)) {
      try {
        const api = url.replace('https://github.com/', 'https://api.github.com/repos/')
        await this.#pace()
        const r = await fetch(api, {
          headers: { 'User-Agent': HARVEST_CONFIG.userAgent, Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(15000)
        })
        if (r.ok) {
          const j = await r.json()
          title = title ?? j.full_name ?? null
          description = description ?? j.description ?? null
        }
      } catch { /* enrichment is best-effort */ }
    }
    const result = { url, httpStatus: response.status, contentType, title, description, retrievedAt: new Date().toISOString() }
    cache.retrieved[url] = result
    await this.#saveCache()
    return result
  }

  async collect () {
    if (!fs.existsSync(this.workflowyFile)) {
      throw new HarvestError(`No workflowy file at ${this.workflowyFile}`)
    }
    const rows = deduplicate(await parseWorkflowyFile(this.workflowyFile))
    logger.info(`[harvest] ${rows.length} unique URLs from workflowy.md`)
    const records = []
    const rejected = []
    let n = 0
    for (const row of rows) {
      n += 1
      if (n % 25 === 0) logger.info(`[harvest] probing ${n}/${rows.length}`)
      let probe
      try {
        probe = await this.probe(row.url)
      } catch (error) {
        rejected.push({ name: row.url, reason: error.message })
        continue
      }
      const finalUrl = probe.url
      records.push({
        url: finalUrl,
        linkText: row.linkText || probe.title || finalUrl,
        title: probe.title,
        description: probe.description,
        contentType: probe.contentType,
        httpStatus: probe.httpStatus,
        retrievedAt: probe.retrievedAt,
        context: row.context,
        sourceLine: row.sourceLine,
        bookmarkTypes: classifyUrl(finalUrl, { contentType: probe.contentType }),
        tags: [domainOf(finalUrl)].filter(Boolean)
      })
    }
    return { records, rejected }
  }

  /** Harvester interface expects harvest() → { plugins } but DIM works in bookmarks. */
  async harvest () {
    const { records, rejected } = await this.collect()
    const bookmarks = []
    for (const record of records) {
      try {
        bookmarks.push(normaliseBookmark(record))
      } catch (error) {
        rejected.push({ name: record.url, reason: error.message })
      }
    }
    return { bookmarks, rejected }
  }
}

export default BookmarkHarvester
