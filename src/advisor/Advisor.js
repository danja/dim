import { rank, isCloseCall, learn } from './score.js'

/**
 * Glue between the scoring and the stores: rank today's tasks with the
 * learnt weights, recent skips and link counts; find what's related to a
 * task; take feedback.
 *
 * tasks: Farelo's TaskStore. advice: AdviceStore. registry: FacetRegistry
 * (set when routes mount), for related resources.
 */

export const MINUTES = Object.freeze([15, 30, 60, 120])

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'this', 'that', 'about', 'some', 'more', 'make', 'do', 'get', 'write', 'finish', 'start', 'fix', 'buy', 'try', 'find', 'look', 'check', 'sort'])

/** The words that say what a task is about (not what to do with it). */
export function topicWords (title) {
  return [...new Set(String(title).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP.has(w)))]
}

export function cleanContext ({ minutes, context } = {}) {
  const m = Number(minutes)
  const c = String(context ?? '').trim().toLowerCase()
  return { minutes: MINUTES.includes(m) ? m : null, context: /^@[a-z0-9-]{1,30}$/.test(c) ? c : null }
}

export class Advisor {
  constructor ({ tasks, advice, links = null, now = () => new Date() }) {
    if (!tasks || !advice) throw new Error('The advisor needs the TaskStore and an AdviceStore')
    Object.assign(this, { tasks, advice, links, now })
    this.registry = null
    this.relatedIndex = null // RelatedIndex, when there is one (set by src/app.js)
  }

  /** → { ranked, closeCall, weights, contexts, total } */
  async suggest ({ minutes = null, context = null, limit = 5 } = {}) {
    const all = await this.tasks.list()
    const [weights, skips, resources] = await Promise.all([this.advice.weights(), this.advice.skips(), this.advice.resourceCounts()])
    const ranked = rank(all, { weights, now: this.now(), minutes, context, skips, resources })
    const contexts = [...new Set(all.flatMap(t => (t.tags ?? []).filter(tag => tag.startsWith('@'))))].sort()
    return { ranked: ranked.slice(0, limit), closeCall: isCloseCall(ranked), weights, contexts, total: ranked.length }
  }

  /** Links from/to the task, then other facets' matches for its title. */
  async related (task, { limit = 6 } = {}) {
    const out = []
    const seen = new Set([task.iri])
    if (this.links && this.registry) {
      for (const l of await this.links.linksOf(task.iri).catch(() => [])) {
        if (seen.has(l.iri)) continue
        seen.add(l.iri)
        const found = await this.registry.lookup(l.iri)
        if (found?.href) out.push({ ...found, why: 'linked' })
      }
    }
    // Meaning first (the shared vector index), then titles' topic words.
    if (this.relatedIndex && this.registry) {
      const hits = await this.relatedIndex.related(task.iri, [task.title, task.note].filter(Boolean).join('\n\n'), { k: limit }).catch(() => [])
      for (const h of hits) {
        if (seen.has(h.iri)) continue
        seen.add(h.iri)
        const found = await this.registry.lookup(h.iri)
        if (found?.href && found.facet && found.facet !== 'farelo') out.push({ ...found, why: 'similar' })
      }
    }
    const words = topicWords(task.title)
    if (this.registry && words.length && out.length < limit) {
      // Similar = at least two thirds of the title's topic words appear (search alone is too loose).
      const needed = Math.max(1, Math.ceil(words.length * 2 / 3))
      const groups = await this.registry.find(words.join(' '), { limit: 5 }).catch(() => [])
      for (const g of groups) {
        if (g.facet === 'farelo') continue
        for (const r of g.results) {
          const text = `${r.label} ${r.snippet ?? ''}`.toLowerCase()
          const hits = words.filter(w => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?($|[^\\p{L}\\p{N}])`, 'u').test(text))
          if (seen.has(r.iri) || hits.length < needed) continue
          seen.add(r.iri)
          out.push({ ...r, facetLabel: g.label, why: 'similar' })
        }
      }
    }
    return out.slice(0, limit)
  }

  /**
   * "I'll do this": learn from what was shown above it, record it, and move
   * the task to Doing. shown: ids in the order they were offered.
   */
  async accept (taskId, { shown = [], minutes = null, context = null, actor }) {
    const task = await this.tasks.get(taskId)
    if (!task) throw Object.assign(new Error('No such task'), { status: 404 })
    const { ranked, weights } = await this.suggest({ minutes, context, limit: Infinity })
    const byId = new Map(ranked.map(r => [r.task.id, r]))
    const chosen = byId.get(taskId)
    const position = shown.indexOf(taskId)
    if (chosen && position > 0) {
      const above = shown.slice(0, position).map(id => byId.get(id)).filter(Boolean)
      if (above.length) await this.advice.saveWeights(learn(weights, chosen, above), actor)
    }
    await this.advice.record({ task: task.iri, action: 'accept', rank: position >= 0 ? position + 1 : null }, actor)
    if (task.status !== 'doing') await this.tasks.move(task, { status: 'doing' }, actor)
    return task
  }

  async skip (taskId, { rank = null, actor }) {
    const task = await this.tasks.get(taskId)
    if (!task) throw Object.assign(new Error('No such task'), { status: 404 })
    await this.advice.record({ task: task.iri, action: 'skip', rank }, actor)
    return task
  }
}

export default Advisor
