import EventStore from '../../src/calendar/EventStore.js'

/** The real EventStore over an empty store, with a clock the test can set (local time, so the day doesn't depend on the TZ). */
export const TODAY = new Date(2026, 9, 6, 12, 0) // Tue 6 Oct 2026

export function memoryEvents ({ now = TODAY } = {}) {
  const writes = []
  let clock = now
  const client = { async select () { return [] } }
  const repository = {
    async facetGraph () { return 'graph:facet/calendar' },
    async replace (change) { writes.push(change) },
    async deleteResources (change) { writes.push({ op: 'delete', ...change }) }
  }
  const store = new EventStore({ client, repository, now: () => clock })
  return { store, writes, setNow: d => { clock = d } }
}
