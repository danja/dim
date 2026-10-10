import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createFareloFacet } from '../../src/farelo/index.js'
import { seeded } from '../../src/farelo/dice.js'

const TOKEN = 'test-token-0123456789abcdef'
const task = (id, extra = {}) => ({ id, iri: `http://purl.org/stuff/dim/task/${id}`, title: `Task ${id}`, status: 'todo', priority: 3, created: `2026-01-0${id.length}`, position: 1, dependsOn: [], tags: [], ...extra })

function stubStore (tasks) {
  return {
    async list () { return tasks.filter(t => !t.archivedAt) },
    async get (id) { return tasks.find(t => t.id === id) ?? null },
    async history () { return [] },
    async listArchived () { return tasks.filter(t => t.archivedAt) },
    async archive (t) { t.archivedAt = '2026-02-03T00:00:00Z'; return t },
    async restore (t) { t.archivedAt = null; return t }
  }
}

let servers = []
async function listen ({ tasks, rolls }) {
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createFareloFacet({ store: stubStore(tasks), rolls, rng: seeded(3) })]
  const server = createServer({ facets, defaultFacet: 'farelo', services: { auth: new Auth({ token: TOKEN }) } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return `http://localhost:${server.address().port}`
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

const roll = (base, body) => fetch(`${base}/farelo/dice`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())

describe('dice route', () => {
  const tasks = [task('ta1', { priority: 1 }), task('tb2', { priority: 2 }), task('tc3', { status: 'blocked' }), task('td4', { dependsOn: ['http://purl.org/stuff/dim/task/tb2'] })]

  it('rolls only for eligible tasks and records the roll', async () => {
    const recorded = []
    const base = await listen({ tasks, rolls: { record: async r => recorded.push(r) } })
    for (let i = 0; i < 20; i++) {
      const { picked } = await roll(base, { policy: 'new' })
      expect(['ta1', 'tb2']).toContain(picked.task.id)
    }
    expect(recorded).toHaveLength(20)
    expect(recorded[0]).toMatchObject({ actor: 'owner', policy: 'new', listSize: 2 })
  })

  it('carries the round forward by policy', async () => {
    const base = await listen({ tasks, rolls: null })
    const replaced = await roll(base, { policy: 'replace', lastTask: 'ta1', lastTarget: 7 })
    expect(replaced.state).toEqual({ exclude: ['ta1'], skip: [] })
    expect(replaced.picked.task.id).toBe('tb2')
    const skipped = await roll(base, { policy: 'skip', lastTask: 'tb2', lastTarget: 6 })
    expect(skipped.state).toEqual({ exclude: [], skip: [6] })
    expect(skipped.picked.task.id).toBe('ta1')
    const none = await roll(base, { policy: 'skip', skip: [7], lastTask: 'tb2', lastTarget: 6 })
    expect(none.picked).toBeNull()
  })

  it('shows the numbered list without logging in', async () => {
    const base = await listen({ tasks, rolls: null })
    const html = await (await fetch(`${base}/farelo/dice`)).text()
    expect(html).toMatch('Getting Things Diced')
    expect((html.match(/<td class="target">/g) ?? []).length).toBe(2)
    expect(html).toMatch('Log in</a> to roll')
  })
})

describe('archiving', () => {
  const post = (base, path) => fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: '{}' })

  it('archives a task out of the board and restores it from the archive', async () => {
    const base = await listen({ tasks: [task('ta1'), task('tb2')], rolls: null })
    expect((await post(base, '/farelo/task/ta1/archive')).status).toBe(200)
    expect(await (await fetch(`${base}/farelo/`)).text()).not.toContain('Task ta1')
    const archived = await (await fetch(`${base}/farelo/archived`)).text()
    expect(archived).toContain('Task ta1')
    expect(archived).not.toContain('Task tb2')
    expect((await post(base, '/farelo/task/ta1/restore')).status).toBe(200)
    expect(await (await fetch(`${base}/farelo/`)).text()).toContain('Task ta1')
  })

  it('answers 404 for an unknown task', async () => {
    const base = await listen({ tasks: [], rolls: null })
    expect((await post(base, '/farelo/task/tdead/archive')).status).toBe(404)
  })
})
