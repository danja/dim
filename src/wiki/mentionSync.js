import { resolveMentions, parseMentions } from '../common/links/mentions.js'
import { parseHashtags } from '../common/hashtags/parse.js'

/**
 * Keep a page's dim:mentions links and #hashtags in step with its text. [[Title]] means a
 * wiki page first, then anything else of that title (registry, optional).
 */
export function mentionSync ({ store, links, registry = null, origin = null }) {
  const resolver = {
    iriFromPath: p => registry?.iriFromPath(p) ?? null,
    iriFromUrl: u => registry?.iriFromUrl(u) ?? null,
    resolveTitle: async t => (await store.byTitle(t))?.iri ?? registry?.resolveTitle(t) ?? null
  }

  async function sync (page, actor) {
    if (!links) return []
    const targets = (await resolveMentions(page.content, { registry: resolver, origin })).filter(t => t !== page.iri)
    await links.syncMentions({ from: page.iri, targets, actor })
    await links.syncHashtags({ from: page.iri, tags: parseHashtags(page.content), actor })
    return targets
  }

  /** A new page may be what earlier [[Title]] links were waiting for. */
  async function syncWaiting (page, actor) {
    const wanted = page.title.toLowerCase()
    for (const other of await store.list()) {
      if (other.slug !== page.slug && parseMentions(other.content).titles.some(t => t.toLowerCase() === wanted)) await sync(other, actor)
    }
  }

  return { sync, syncWaiting }
}

export default mentionSync
