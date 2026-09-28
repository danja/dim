import logger from 'loglevel'
import { ENRICH_CONFIG } from '../../../config/preferences.js'
import { contentHash } from './Fetchers.js'

/**
 * Second-pass enricher orchestrator (docs/enricher.md).
 *
 * Chains fetch → extract → summarise → write. Plugin selection is
 * first-canHandle-wins over the injected registries; the orchestrator
 * itself has no per-site or per-format knowledge, so extending it means
 * adding a plugin, not editing this file.
 */

export class EnrichError extends Error {
  constructor (message, { url = null, cause = null } = {}) {
    super(message)
    this.name = 'EnrichError'
    this.url = url
    if (cause) this.cause = cause
  }
}

function pick (plugins, ctx, kind) {
  const plugin = plugins.find(p => {
    try {
      return p.canHandle(ctx)
    } catch {
      return false
    }
  })
  if (!plugin) throw new EnrichError(`No ${kind} plugin handles ${ctx.url}`)
  return plugin
}

export class Enricher {
  /**
   * observers: [{ observe({ bookmarkIri, url, fetched }) }], shown every page
   * fetched (e.g. to look for its feeds); their failures are only logged.
   */
  constructor ({ fetchers = [], extractors = [], summarisers = [], writers = [], observers = [], cache = null, cacheTtlMs = ENRICH_CONFIG.cacheTtlMs } = {}) {
    if (!fetchers.length) throw new EnrichError('Enricher needs fetchers')
    if (!extractors.length) throw new EnrichError('Enricher needs extractors')
    if (!summarisers.length) throw new EnrichError('Enricher needs summarisers')
    this.fetchers = fetchers
    this.extractors = extractors
    this.summarisers = summarisers
    this.writers = writers
    this.observers = observers
    this.cache = cache
    this.cacheTtlMs = cacheTtlMs
  }

  /**
   * @param {{iri, graph, url, linkText?, bookmarkTypes?, contentType?, hasEnrichment?}} bookmark
   *   hasEnrichment: whether the store row already carries enrichment
   *   (summary or fetch status). false lets a cache hit restore it — a
   *   re-ingest drops the graph, and the cache would otherwise hide that.
   * @returns {Promise<{status, iri, url, enrichment?}>}
   *   status: enriched | restored | unchanged | fresh | refused | failed
   *   enrichment: { summary?, summaryModel?, summarisedAt, keywords?,
   *     markdown?, contentHash?, contentLength?, fetchStatus?, catalogue? }
   */
  async run (bookmark, { force = false } = {}) {
    const { iri: bookmarkIri, graph, url } = bookmark
    if (!bookmarkIri || !graph || !url) {
      throw new EnrichError(`Enricher needs iri+graph+url, got ${JSON.stringify(bookmark)}`)
    }
    const ctx = {
      url,
      linkText: bookmark.linkText ?? null,
      bookmarkType: bookmark.bookmarkTypes ?? [],
      contentType: bookmark.contentType ?? null
    }

    if (!force && this.cache) {
      const cached = await this.cache.get(url)
      if (cached && this.cache.isFresh(cached, this.cacheTtlMs)) {
        return this.#fromCache('fresh', bookmark, cached)
      }
    }

    let fetched
    try {
      fetched = await pick(this.fetchers, ctx, 'fetcher').fetch(url, ctx)
    } catch (error) {
      logger.warn(`[enrich] fetch failed for ${url}: ${error.message}`)
      return { status: 'failed', iri: bookmarkIri, url, error: error.message }
    }

    if (!fetched || fetched.body == null) {
      const enrichment = {
        fetchStatus: fetched?.httpStatus ?? null,
        summarisedAt: new Date().toISOString()
      }
      await this.#write({ graph, bookmarkIri, url, enrichment, rawText: null })
      return { status: fetched?.refused ? 'refused' : 'failed', iri: bookmarkIri, url, enrichment }
    }

    for (const observer of this.observers) {
      try {
        await observer.observe({ bookmarkIri, url, fetched })
      } catch (error) {
        logger.warn(`[enrich] observer failed for ${url}: ${error.message}`)
      }
    }

    const extractCtx = { ...ctx, contentType: fetched.contentType ?? ctx.contentType, fetched }
    let extracted = null
    try {
      extracted = await pick(this.extractors, extractCtx, 'extractor').extract(fetched, extractCtx)
    } catch (error) {
      logger.warn(`[enrich] extract failed for ${url}: ${error.message}`)
      return { status: 'failed', iri: bookmarkIri, url, error: error.message }
    }
    if (!extracted?.text) {
      return { status: 'failed', iri: bookmarkIri, url, error: 'no extractable text' }
    }

    const hash = contentHash(extracted.text)
    if (!force && this.cache) {
      const cached = await this.cache.get(url)
      if (cached?.contentHash === hash && cached?.summary) {
        return this.#fromCache('unchanged', bookmark, cached)
      }
    }

    let summarised = null
    for (const summariser of this.summarisers) {
      try {
        summarised = await summariser.summarise(extracted.text, { ...ctx, title: extracted.title })
      } catch (error) {
        logger.warn(`[enrich] summariser ${summariser.id} failed for ${url}: ${error.message}`)
        summarised = null
      }
      if (summarised?.summary) break
    }
    if (!summarised?.summary) {
      return { status: 'failed', iri: bookmarkIri, url, error: 'no summary produced' }
    }

    const enrichment = {
      summary: summarised.summary,
      summaryModel: summarised.model,
      summarisedAt: new Date().toISOString(),
      keywords: summarised.keywords ?? [],
      markdown: summarised.markdown ?? null,
      contentHash: hash,
      contentLength: extracted.text.length,
      fetchStatus: fetched.httpStatus ?? null,
      catalogue: fetched.catalogue ?? null
    }
    await this.#write({ graph, bookmarkIri, url, enrichment, rawText: extracted.text })
    return { status: 'enriched', iri: bookmarkIri, url, enrichment }
  }

  /** A cache hit: restore it to the store if the store has lost it. */
  async #fromCache (status, bookmark, cached) {
    const { iri: bookmarkIri, graph, url } = bookmark
    const restorable = cached.summary || typeof cached.fetchStatus === 'number'
    if (bookmark.hasEnrichment === false && restorable) {
      const { url: _url, cachedAt: _cachedAt, ...enrichment } = cached
      await this.#write({ graph, bookmarkIri, url, enrichment, rawText: null })
      return { status: 'restored', iri: bookmarkIri, url, enrichment: cached }
    }
    return { status, iri: bookmarkIri, url, enrichment: cached }
  }

  async #write ({ graph, bookmarkIri, url, enrichment, rawText }) {
    for (const writer of this.writers) {
      try {
        await writer.write({ graph, bookmarkIri, url, enrichment, rawText })
      } catch (error) {
        logger.warn(`[enrich] writer ${writer.constructor.name} failed for ${url}: ${error.message}`)
      }
    }
  }
}

export default Enricher
