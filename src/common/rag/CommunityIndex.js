import fs from 'fs'
import VectorOperations from '../vectors/VectorOperations.js'

/**
 * The community summaries bin/communities.js builds (data/communities.json):
 * derived and rebuildable. Each: { id, size, summary, llm, members: [iri]
 * (best connected first), vector }. Searched by cosine against a query vector.
 */
export class CommunityIndex {
  constructor ({ path, communities = [], builtAt = null }) {
    Object.assign(this, { path, communities, builtAt })
  }

  static async open (path) {
    try {
      const saved = JSON.parse(await fs.promises.readFile(path, 'utf8'))
      return new CommunityIndex({ path, communities: saved.communities ?? [], builtAt: saved.builtAt ?? null })
    } catch {
      return new CommunityIndex({ path })
    }
  }

  get size () { return this.communities.length }

  /** Pick up a rebuild by bin/communities.js without a server restart. */
  async refresh () {
    const mtime = await fs.promises.stat(this.path).then(s => s.mtimeMs, () => null)
    if (mtime === this.mtime) return
    this.mtime = mtime
    const fresh = await CommunityIndex.open(this.path)
    this.communities = fresh.communities
    this.builtAt = fresh.builtAt
  }

  async save (communities) {
    this.communities = communities
    this.builtAt = new Date().toISOString()
    this.mtime = undefined
    await fs.promises.writeFile(this.path, JSON.stringify({ builtAt: this.builtAt, communities }))
  }

  /** → [{ ...community (no vector), score }] best first */
  search (vector, { k = 2, minScore = 0.5 } = {}) {
    return this.communities
      .map(({ vector: v, ...c }) => ({ ...c, score: v ? VectorOperations.cosineSimilarity(vector, v) : 0 }))
      .filter(c => c.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
  }
}

export default CommunityIndex
