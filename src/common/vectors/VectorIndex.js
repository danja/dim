import fs from 'fs'
import path from 'path'
import faiss from 'faiss-node'
import VectorOperations from './VectorOperations.js'
import { withFileLock, writeWhole, savedWriteId, newWriteId } from './indexFile.js'

/**
 * The vector index: persisted, incrementally updated, and on the hot path.
 *
 * Three properties this deliberately has, each of which semem's equivalent
 * lacks (docs/architecture.md §5):
 *
 *  1. Search goes through the index. Nothing pulls candidate rows out of SPARQL
 *     to compute similarity in JavaScript.
 *  2. The index persists to disk and is loaded on start, rather than being
 *     rebuilt by reading every embedding out of the triple store.
 *  3. Vectors live here, not in RDF. The graph records the model, dimension and
 *     a hash of the embedded text — enough to detect a stale embedding without
 *     storing the numbers twice.
 *
 * Vectors are normalised on the way in, so the inner-product index behaves as a
 * cosine index and the score is directly comparable with a cosine threshold.
 *
 * FAISS is an implementation detail behind this interface. Swapping it for
 * sqlite-vec or Qdrant should not require a change outside this file.
 */

export class VectorIndexError extends Error {
  constructor (message) {
    super(message)
    this.name = 'VectorIndexError'
  }
}

const SIDECAR_VERSION = 1

export class VectorIndex {
  /**
   * @param {{dimension: number, path: string, model: string}} options
   */
  constructor ({ dimension, path: indexPath, model }) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new VectorIndexError(`Index dimension must be a positive integer, got ${dimension}`)
    }
    if (!indexPath) throw new VectorIndexError('Index needs a path to persist to')
    if (!model) throw new VectorIndexError('Index must record which embedding model produced it')

    this.dimension = dimension
    this.path = indexPath
    this.sidecarPath = `${indexPath}.json`
    this.model = model

    this.index = new faiss.IndexFlatIP(dimension)
    // FAISS addresses vectors by ordinal position; the catalogue addresses them
    // by IRI. These two maps are the whole of the translation.
    this.iriByPosition = []
    this.positionByIri = new Map()
    // Positions superseded by a replacement. Skipped by search, reclaimed by
    // compact().
    this.orphans = new Set()
    this.dirty = false
    // Changes made here since this process last read or wrote the file
    // (iri → normalised vector, or null for a removal): re-applied if another
    // process saved in between, so neither overwrites the other.
    this.pending = new Map()
    this.writeId = null
  }

  /** Live entries. Orphaned positions awaiting compaction do not count. */
  get size () {
    return this.positionByIri.size
  }

  has (iri) {
    return this.positionByIri.has(iri)
  }

  /**
   * Add or replace one plugin's vector.
   *
   * FAISS IndexFlatIP has no delete, so a replacement is recorded by pointing
   * the IRI at the new position and orphaning the old one. Orphans are dropped
   * by compact(), which is cheap enough to run after a bulk update.
   */
  add (iri, vector) {
    if (!iri) throw new VectorIndexError('A vector needs an IRI to be addressable')
    VectorOperations.validate(vector, this.dimension)
    const normalised = VectorOperations.normalize(vector)

    const previous = this.positionByIri.get(iri)
    if (previous !== undefined) this.orphans.add(previous)

    this.index.add(normalised)
    const position = this.index.ntotal() - 1
    this.iriByPosition[position] = iri
    this.positionByIri.set(iri, position)
    this.pending.set(iri, Float32Array.from(normalised))
    this.dirty = true
    return position
  }

  /** Forget one IRI (its position is reclaimed by compact()). → whether it was there */
  remove (iri) {
    const position = this.positionByIri.get(iri)
    // Recorded even when unknown here: another process may have added it since.
    this.pending.set(iri, null)
    if (position === undefined) return false
    this.orphans.add(position)
    this.positionByIri.delete(iri)
    this.dirty = true
    return true
  }

  addBatch (entries) {
    for (const [iri, vector] of entries) this.add(iri, vector)
    return this.size
  }

  /**
   * @returns {Array<{iri: string, score: number}>} descending by score
   */
  search (vector, k = 10, { minScore = null } = {}) {
    VectorOperations.validate(vector, this.dimension)
    if (this.index.ntotal() === 0) return []

    const normalised = VectorOperations.normalize(vector)
    // Over-fetch so orphaned positions and sub-threshold hits do not eat into k.
    const requested = Math.min(this.index.ntotal(), Math.max(k * 2, k + 10))
    const { distances, labels } = this.index.search(normalised, requested)

    const results = []
    for (let i = 0; i < labels.length; i++) {
      const position = labels[i]
      if (position < 0) continue
      if (this.orphans.has(position)) continue
      const iri = this.iriByPosition[position]
      if (iri === undefined) continue
      const score = distances[i]
      if (minScore !== null && score < minScore) continue
      results.push({ iri, score })
      if (results.length === k) break
    }
    return results
  }

  /**
   * Reclaim positions left behind by replacements.
   *
   * FAISS removeIds on a flat index compacts order-preservingly: survivors keep
   * their relative order and are renumbered from zero. So the new mapping is
   * the live positions in ascending order, renumbered sequentially — verified
   * against faiss-node rather than assumed.
   *
   * @returns {number} positions reclaimed
   */
  compact () {
    if (this.orphans.size === 0) return 0

    const doomed = [...this.orphans].sort((a, b) => a - b)
    const removed = this.index.removeIds(doomed)

    const survivors = this.iriByPosition
      .map((iri, position) => ({ iri, position }))
      .filter(entry => entry.iri !== undefined && !this.orphans.has(entry.position))
      .sort((a, b) => a.position - b.position)

    this.iriByPosition = []
    this.positionByIri = new Map()
    survivors.forEach((entry, newPosition) => {
      this.iriByPosition[newPosition] = entry.iri
      this.positionByIri.set(entry.iri, newPosition)
    })
    this.orphans.clear()
    this.dirty = true

    if (this.index.ntotal() !== this.iriByPosition.length) {
      throw new VectorIndexError(
        `Compaction desynchronised the index: FAISS holds ${this.index.ntotal()} vectors, ` +
        `the mapping holds ${this.iriByPosition.length}. The index must be rebuilt.`
      )
    }
    return removed
  }

  /**
   * Persist index and sidecar. The sidecar carries the IRI mapping and the
   * model identity — an index whose model is unknown is not safely reusable,
   * because vectors from two models are not comparable.
   *
   * Several processes may use one index file (the server embeds bookmarks as
   * they're saved; bin/enrich.js --reembed runs beside it). A save takes a
   * short lock; if someone else saved since this process last read or wrote
   * the file, it reloads that first and re-applies its own changes.
   */
  async save () {
    await fs.promises.mkdir(path.dirname(this.path), { recursive: true })
    return withFileLock(`${this.path}.lock`, async () => {
      const onDisk = await savedWriteId(this.sidecarPath)
      if (onDisk && onDisk !== this.writeId) await this.#mergeFromDisk()
      const saving = new Map(this.pending) // changes made while writing stay pending
      const writeId = newWriteId()
      await writeWhole(this.path, this.index.toBuffer())
      await writeWhole(this.sidecarPath, JSON.stringify({
        version: SIDECAR_VERSION,
        model: this.model,
        dimension: this.dimension,
        count: this.size,
        savedAt: new Date().toISOString(),
        writeId,
        iriByPosition: this.iriByPosition,
        orphans: [...this.orphans]
      }, null, 2))
      this.writeId = writeId
      for (const [iri, vector] of saving) if (this.pending.get(iri) === vector) this.pending.delete(iri)
      this.dirty = this.pending.size > 0
      return this.path
    })
  }

  /** Take on what's on disk, then this process's own changes again. */
  async #mergeFromDisk () {
    const mine = [...this.pending]
    this.#adopt(await VectorIndex.load(this) ?? new VectorIndex(this))
    for (const [iri, vector] of mine) {
      if (vector) this.add(iri, Array.from(vector))
      else this.remove(iri)
    }
    this.compact()
  }

  /** Swap in another instance's contents, keeping this object (others hold it). */
  #adopt (other) {
    Object.assign(this, { index: other.index, iriByPosition: other.iriByPosition, positionByIri: other.positionByIri, orphans: other.orphans, writeId: other.writeId })
    this.pending = new Map()
  }

  /**
   * Pick up a save made by another process (the server calls this every
   * minute). Waits for this process's own changes to be saved first; that
   * save merges anyway. → whether it reloaded
   */
  async refresh () {
    if (this.pending.size) return false
    const onDisk = await savedWriteId(this.sidecarPath)
    if (!onDisk || onDisk === this.writeId) return false
    const loaded = await VectorIndex.load(this)
    if (!loaded || this.pending.size) return false
    this.#adopt(loaded)
    return true
  }

  /**
   * Load a persisted index. Refuses to load one built by a different model or
   * at a different dimension — silently mixing embedding spaces produces
   * results that look plausible and are meaningless.
   *
   * @returns {Promise<VectorIndex|null>} null if no index has been saved yet
   */
  static async load ({ dimension, path: indexPath, model }) {
    const sidecarPath = `${indexPath}.json`
    if (!fs.existsSync(indexPath) || !fs.existsSync(sidecarPath)) return null

    const sidecar = JSON.parse(await fs.promises.readFile(sidecarPath, 'utf8'))
    if (sidecar.model !== model) {
      throw new VectorIndexError(
        `Index at ${indexPath} was built with model "${sidecar.model}" but "${model}" is configured. ` +
        'Vectors from different models are not comparable; rebuild the index.'
      )
    }
    if (sidecar.dimension !== dimension) {
      throw new VectorIndexError(
        `Index at ${indexPath} has dimension ${sidecar.dimension}, configured dimension is ${dimension}.`
      )
    }

    const instance = new VectorIndex({ dimension, path: indexPath, model })
    instance.index = faiss.IndexFlatIP.fromBuffer(await fs.promises.readFile(indexPath))
    instance.iriByPosition = sidecar.iriByPosition
    instance.orphans = new Set(sidecar.orphans ?? [])
    instance.positionByIri = new Map()
    sidecar.iriByPosition.forEach((iri, position) => {
      if (iri === null || iri === undefined) return
      if (instance.orphans.has(position)) return
      instance.positionByIri.set(iri, position)
    })
    instance.writeId = sidecar.writeId ?? null
    instance.dirty = false
    return instance
  }

  /** Load if present, otherwise start empty. The normal startup path. */
  static async open (options) {
    const loaded = await VectorIndex.load(options)
    return loaded ?? new VectorIndex(options)
  }
}

export default VectorIndex
