import fs from 'fs'
import logger from 'loglevel'
import { textHash } from '../embeddings/EmbeddingService.js'

/**
 * Meaning shared across facets. Wiki pages, tasks, outline items, blog posts
 * and recent news items are embedded into one vector index beside the
 * bookmarks' own (which stays as it is), so any resource can find what is
 * like it anywhere in DIM.
 *
 * Facets offer their text through a documents() hook → [{ iri, text }].
 * sync() embeds what is new or changed (by a hash of the text) and forgets
 * what has gone; a state file keeps the hashes, the owning facet and, for
 * news items, an interest score (how close the item is to your own things).
 */

const MAX_TEXT = 2000

export class RelatedIndex {
  constructor ({ index, bookmarks = null, embeddings, statePath, minScore = 0.55 }) {
    Object.assign(this, { index, bookmarks, embeddings, statePath, minScore })
    this.state = new Map() // iri → { hash, facet, interest }
    this.cache = new Map() // text hash → vector (recent queries)
    this.running = null
  }

  async load () {
    try {
      const saved = JSON.parse(await fs.promises.readFile(this.statePath, 'utf8'))
      this.state = new Map(Object.entries(saved.entries ?? {}))
    } catch {
      this.state = new Map()
    }
    return this
  }

  async #save () {
    this.index.compact()
    await this.index.save()
    await fs.promises.writeFile(this.statePath, JSON.stringify({ savedAt: new Date().toISOString(), entries: Object.fromEntries(this.state) }))
  }

  /** A text's vector, or null when there's no text or embeddings are down (retried after 5 min). */
  async vectorFor (text) {
    const clean = String(text ?? '').trim().slice(0, MAX_TEXT)
    if (!clean) return null
    const key = textHash(clean)
    if (this.cache.has(key)) return this.cache.get(key)
    if (Date.now() < (this.downUntil ?? 0)) return null
    let vector
    try {
      vector = await this.embeddings.embed(clean)
    } catch (error) {
      logger.warn(`[related] ${error.message}; not trying again for 5 minutes`)
      this.downUntil = Date.now() + 5 * 60000
      return null
    }
    this.cache.set(key, vector)
    if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value)
    return vector
  }

  /** Nearest things to a vector across both indexes, best first. */
  nearest (vector, { k = 6, exclude = new Set(), minScore = this.minScore, skipFacet = null } = {}) {
    const hits = [...this.index.search(vector, k * 3, { minScore }), ...(this.bookmarks?.search(vector, k * 3, { minScore }) ?? [])]
    const seen = new Set()
    return hits
      .filter(h => !exclude.has(h.iri) && !(skipFacet && this.state.get(h.iri)?.facet === skipFacet) && !seen.has(h.iri) && seen.add(h.iri))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }

  /** What is like this resource (by its text). → [{ iri, score }] */
  async related (iri, text, options = {}) {
    const vector = await this.vectorFor(text)
    return vector ? this.nearest(vector, { ...options, exclude: new Set([iri]) }) : []
  }

  /** How close a news item is to your own things (0–1), if known. */
  interest (iri) {
    return this.state.get(iri)?.interest ?? null
  }

  /**
   * Bring the index in step with the facets. One run at a time.
   * → { embedded, removed, unchanged, failed, stopped }
   */
  sync (facets, options = {}) {
    if (this.running) return this.running
    this.running = this.#sync(facets, options).finally(() => { this.running = null })
    return this.running
  }

  async #sync (facets, { limit = Infinity, onProgress = null } = {}) {
    const totals = { embedded: 0, removed: 0, unchanged: 0, failed: 0, stopped: false }
    const live = new Set()
    const todo = []
    for (const facet of facets) {
      if (typeof facet.documents !== 'function') continue
      for (const doc of await facet.documents()) {
        const text = String(doc.text ?? '').trim().slice(0, MAX_TEXT)
        if (!text) continue
        live.add(doc.iri)
        const hash = textHash(text)
        if (this.state.get(doc.iri)?.hash === hash && this.index.has(doc.iri)) totals.unchanged++
        else todo.push({ iri: doc.iri, text, hash, facet: facet.id })
      }
    }
    for (const [iri] of this.state) {
      if (!live.has(iri)) {
        this.index.remove(iri)
        this.state.delete(iri)
        totals.removed++
      }
    }
    // Your own things first, so news interest can be measured against them.
    todo.sort((a, b) => (a.facet === 'news') - (b.facet === 'news'))
    let failuresInARow = 0
    for (const item of todo.slice(0, limit)) {
      let vector
      try {
        vector = await this.embeddings.embed(item.text)
        failuresInARow = 0
      } catch (error) {
        totals.failed++
        if (++failuresInARow >= 3) {
          logger.warn(`[related] embedding unavailable (${error.message}); stopping this run`)
          totals.stopped = true
          break
        }
        continue
      }
      this.index.add(item.iri, vector)
      const entry = { hash: item.hash, facet: item.facet }
      if (item.facet === 'news') entry.interest = Math.round((this.nearest(vector, { k: 1, minScore: 0, skipFacet: 'news', exclude: new Set([item.iri]) })[0]?.score ?? 0) * 1000) / 1000
      this.state.set(item.iri, entry)
      totals.embedded++
      onProgress?.(totals)
      if (totals.embedded % 200 === 0) await this.#save()
    }
    if (totals.embedded || totals.removed) await this.#save()
    return totals
  }
}

export default RelatedIndex
