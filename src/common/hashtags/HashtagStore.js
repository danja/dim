import QueryService from '../store/QueryService.js'
import { iri } from '../store/SPARQLHelper.js'
import { tagIri } from './triples.js'
import { typeSlugOf } from '../links/mentions.js'

/**
 * Reading hashtags (written by LinkStore.syncHashtags). Live queries: tags
 * are written whenever a note is saved, so nothing is cached here.
 */
export class HashtagStore {
  constructor ({ client, queries = new QueryService(), graph = 'graph:facet/links' }) {
    Object.assign(this, { client, queries, graph: iri(graph) })
  }

  /** → [{ tag, iri }] one per use. */
  async uses () {
    return (await this.client.select(this.queries.get('hashtags/uses', { graph: this.graph }))).map(r => ({ tag: r.label, iri: r.s }))
  }

  /** The resources with a tag or any tag under it. → [iri] */
  async under (tag) {
    return (await this.client.select(this.queries.get('hashtags/under', { graph: this.graph, concept: iri(tagIri(tag)) }))).map(r => r.s)
  }

  /** The tags that exist: Map tag → broader tag or null. */
  async concepts () {
    return new Map((await this.client.select(this.queries.get('hashtags/concepts', { graph: this.graph }))).map(r => [r.label, r.broader ?? null]))
  }

  /** → { broader: tag | null, narrower: [tag] } */
  async family (tag) {
    const concepts = await this.concepts()
    return { broader: concepts.get(tag) ?? null, narrower: [...concepts].filter(([, b]) => b === tag).map(([t]) => t).sort() }
  }

  /**
   * Hashtag uses folded into the tag list of registry.tags():
   * [{ tag, count, facets }] merged into `tags` (which it returns).
   */
  async addCounts (tags, registry) {
    const byTag = new Map(tags.map(t => [t.tag, t]))
    const seen = new Map()
    for (const { tag, iri: resource } of await this.uses()) {
      const key = `${tag}|${resource}`
      if (seen.has(key)) continue
      seen.set(key, true)
      const ts = typeSlugOf(resource)
      const label = (ts && registry.typePaths.get(ts.type)?.facet.label) ?? 'other'
      const entry = byTag.get(tag) ?? { tag, count: 0, facets: [] }
      entry.count++
      if (!entry.facets.includes(label)) entry.facets.push(label)
      byTag.set(tag, entry)
    }
    return [...byTag.values()].sort((a, b) => (b.count - a.count) || a.tag.localeCompare(b.tag))
  }

  /** Resources with a hashtag, added to registry.tagged() groups. */
  async addTagged (groups, tag, registry) {
    const have = new Set(groups.flatMap(g => g.results.map(r => r.iri)))
    for (const resource of await this.under(tag)) {
      if (have.has(resource)) continue
      const found = await registry.lookup(resource)
      if (!found?.href || !found.facet) continue
      let group = groups.find(g => g.facet === found.facet)
      if (!group) groups.push(group = { facet: found.facet, label: found.facetLabel, results: [] })
      group.results.push({ iri: resource, label: found.label, href: found.href, snippet: 'hashtag' })
    }
    return groups
  }
}

export default HashtagStore
