import QueryService from '../store/QueryService.js'
import { termKey } from './buildTopics.js'

/**
 * The topic scheme and who has which topic (graph:alignment/topics, written
 * by bin/topics.js), read once and held in memory.
 */
export class TopicStore {
  constructor ({ client, queries = new QueryService() }) {
    Object.assign(this, { client, queries })
    this.topics = null
  }

  reset () {
    this.topics = null
  }

  async #load () {
    if (this.topics) return
    const rows = await this.client.select(this.queries.get('topics/concepts', {})).catch(() => [])
    const topics = new Map(rows.map(r => [r.topic, {
      iri: r.topic,
      slug: r.topic.slice(r.topic.lastIndexOf('/topic-') + 7),
      label: r.label,
      altLabels: r.alts ? r.alts.split(' | ').filter(Boolean) : [],
      broader: r.broader ?? null,
      narrower: [],
      members: []
    }]))
    for (const t of topics.values()) if (t.broader && topics.has(t.broader)) topics.get(t.broader).narrower.push(t.iri)
    this.bySubject = new Map()
    for (const r of await this.client.select(this.queries.get('topics/subjects', {})).catch(() => [])) {
      const t = topics.get(r.topic)
      if (!t) continue
      t.members.push(r.s)
      if (!this.bySubject.has(r.s)) this.bySubject.set(r.s, [])
      this.bySubject.get(r.s).push(t)
    }
    this.byKey = new Map()
    for (const t of topics.values()) for (const name of [t.label, ...t.altLabels]) { const k = termKey(name); if (k) this.byKey.set(k, t) }
    this.topics = topics
  }

  async list () {
    await this.#load()
    return [...this.topics.values()].sort((a, b) => (b.members.length - a.members.length) || a.label.localeCompare(b.label))
  }

  async get (slug) {
    await this.#load()
    return [...this.topics.values()].find(t => t.slug === slug) ?? null
  }

  async byIri (iri) {
    await this.#load()
    return this.topics.get(iri) ?? null
  }

  /** The topics a resource has. */
  async topicsOf (iri) {
    await this.#load()
    return this.bySubject.get(iri) ?? []
  }

  /** The topic a tag names, if any ("Synth-DIY" → synth diy). */
  async forTag (tag) {
    await this.#load()
    const k = termKey(tag)
    return (k && (this.byKey.get(k) ?? this.byKey.get(k.replace(/s$/, '')))) || null
  }
}

export default TopicStore
