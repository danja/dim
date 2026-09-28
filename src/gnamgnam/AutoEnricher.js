import logger from 'loglevel'
import { composeText } from './BookmarkText.js'

/**
 * A bookmark saved inside DIM (Squirt capture, News "save as bookmark") is
 * fetched, summarised and embedded straight away, in the background, one
 * at a time: the same enricher as `bin/enrich.js` (GET → extract →
 * summarise → patch the store; the fetch status is the link check), then
 * the document is reloaded and its vector added to the bookmark index.
 *
 * createEnricher is called on first use, so a summariser that can't be
 * configured (e.g. `remote` without LLM_* settings) only disables this,
 * with a log line, and never stops the server.
 */

export class AutoEnricher {
  constructor ({ createEnricher, search, embeddings, index, saveDelayMs = 5000 }) {
    Object.assign(this, { createEnricher, search, embeddings, index, saveDelayMs })
    this.queue = []
    this.state = new Map() // iri → 'queued' | 'working'
    this.running = null
    this.enricher = undefined
    this.saveTimer = null
    this.dirty = false
  }

  /** Does this bookmark still need fetching/summarising or a vector? */
  needs (doc) {
    return Boolean(doc) && ((!doc.summary && doc.fetchStatus == null) || !this.index.has(doc.iri))
  }

  status (iri) {
    return this.state.get(iri) ?? null
  }

  /** Queue a bookmark (once). → whether it was queued. */
  enqueue (iri) {
    if (this.state.has(iri)) return false
    this.state.set(iri, 'queued')
    this.queue.push(iri)
    this.running ??= this.#drain().finally(() => { this.running = null })
    return true
  }

  /** Resolves when the queue is empty (tests, shutdown). */
  async idle () {
    while (this.running) await this.running
  }

  async #drain () {
    for (let iri = this.queue.shift(); iri; iri = this.queue.shift()) {
      this.state.set(iri, 'working')
      try {
        const outcome = await this.process(iri)
        logger.info(`[auto-enrich] ${iri}: ${outcome.status}${outcome.embedded ? ', embedded' : ''}`)
      } catch (error) {
        logger.warn(`[auto-enrich] ${iri}: ${error.message}`)
      } finally {
        this.state.delete(iri)
      }
    }
  }

  #getEnricher () {
    if (this.enricher === undefined) {
      try {
        this.enricher = this.createEnricher()
      } catch (error) {
        logger.warn(`[auto-enrich] off: ${error.message}`)
        this.enricher = null
      }
    }
    return this.enricher
  }

  /** Enrich (if needed) and embed one bookmark. → { status, embedded } */
  async process (iri) {
    let doc = this.search.documents.get(iri) ?? await this.search.loadDocument(iri)
    if (!doc) return { status: 'missing', embedded: false }
    let status = 'already enriched'
    if (!doc.summary && doc.fetchStatus == null) {
      const enricher = this.#getEnricher()
      status = 'not enriched'
      if (enricher) {
        const { graph, url, linkText, bookmarkTypes, contentType } = doc
        status = (await enricher.run({ iri, graph, url, linkText, bookmarkTypes, contentType, hasEnrichment: false })).status
        doc = (await this.search.loadDocument(iri)) ?? doc
      }
    }
    let embedded = false
    try {
      this.index.add(iri, await this.embeddings.embed(composeText(doc)))
      embedded = true
      this.dirty = true
      this.#saveSoon()
    } catch (error) {
      // Ollama down: the bookmark is still found by its words; a later
      // `bin/enrich.js --reembed` (or saving it again) adds the vector.
      logger.warn(`[auto-enrich] no vector for ${iri}: ${error.message}`)
    }
    return { status, embedded }
  }

  /** Several saves close together write the index once. */
  #saveSoon () {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush().catch(error => logger.warn(`[auto-enrich] saving the index failed: ${error.message}`)), this.saveDelayMs)
    this.saveTimer.unref?.()
  }

  /** Write the index if this has changed it (only then: another tool may have saved it since). */
  async flush () {
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty) return
    this.dirty = false
    this.index.compact()
    await this.index.save()
  }
}

export default AutoEnricher
