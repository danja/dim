import { WikiStore } from '../../src/wiki/WikiStore.js'

/** A WikiStore over an empty store that records what it writes. */
export function memoryWiki () {
  const writes = []
  const client = { async select () { return [] }, async construct () { return '' } }
  const repository = {
    async facetGraph () { return 'http://purl.org/stuff/dim/graph/facet/wiki' },
    async add (change) { writes.push({ op: 'add', ...change }) },
    async replace (change) { writes.push({ op: 'replace', ...change }) },
    async deleteResources (change) { writes.push({ op: 'delete', ...change }) }
  }
  let tick = 0
  const store = new WikiStore({ client, repository, now: () => new Date(Date.UTC(2026, 8, 1, 0, 0, tick++)) })
  return { store, writes }
}
