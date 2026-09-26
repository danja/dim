import PostStore from '../../src/blog/PostStore.js'

/** The real PostStore over an empty store, with a clock the test moves. */
export function memoryPosts ({ start = '2026-09-26T10:00:00Z' } = {}) {
  const writes = []
  let clock = new Date(start).getTime()
  const client = { async select () { return [] } }
  const repository = {
    async facetGraph () { return 'graph:facet/blog' },
    async replace (change) { writes.push(change) },
    async deleteResources (change) { writes.push({ op: 'delete', ...change }) }
  }
  const store = new PostStore({ client, repository, now: () => new Date(clock) })
  return { store, writes, advance: ms => { clock += ms } }
}
