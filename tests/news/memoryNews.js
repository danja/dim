import GraphRegistry from '../../src/common/store/GraphRegistry.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'
import NewsStore from '../../src/news/NewsStore.js'

/**
 * The real NewsStore over an empty store: reads come back empty, writes are
 * recorded, items are validated by the real shapes.
 */
export async function memoryNews ({ now = () => new Date('2026-09-26T12:00:00Z') } = {}) {
  const updates = []
  const client = {
    async select () { return [] },
    async update (sparql) { updates.push(sparql) },
    async ask () { return false }
  }
  const registry = Object.assign(Object.create(GraphRegistry.prototype), { async isRegistered () { return true } })
  const changes = []
  const repository = {
    registry,
    validator: await ShapeValidator.load(),
    async facetGraph (id) { return `graph:facet/${id}` },
    async replace (change) { changes.push({ op: 'replace', ...change }) },
    async add (change) { changes.push({ op: 'add', ...change }) },
    async deleteResources (change) { changes.push({ op: 'delete', ...change }) }
  }
  const store = new NewsStore({ client, repository, now })
  return { store, updates, changes, client, repository }
}

/** A fetch that answers from a table: url → { status, body, headers } or a function of the request. */
export function fakeFetch (table) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers ?? {} })
    let entry = table[url]
    if (typeof entry === 'function') entry = entry(init)
    if (!entry) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    return new Response(entry.status === 304 ? null : entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? {} })
  }
  return { impl, calls }
}
