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

describe('make a page or outline item from a task', () => {
  it('creates it through the owning facet and links the two', async () => {
    const tasks = [task('ta1', { note: 'Details' })]
    const created = []
    const added = []
    const wiki = {
      id: 'wiki',
      label: 'Wiki',
      routes () {},
      async create (args) { created.push(args); return { iri: 'http://purl.org/stuff/dim/page/task-ta1', label: 'Task ta1', href: '/wiki/page/task-ta1', created: true } }
    }
    const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
    const facets = [createGnamgnamFacet({ search }), createFareloFacet({ store: stubStore(tasks), rng: seeded(3) }), wiki]
    const services = { auth: new Auth({ token: TOKEN }), links: { add: async a => added.push(a), linksOf: async () => [], syncMentions: async () => {}, syncHashtags: async () => {} } }
    const server = createServer({ facets, defaultFacet: 'farelo', services })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`
    const post = facet => fetch(`${base}/farelo/task/ta1/make`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ facet }) })

    const ok = await post('wiki')
    expect(ok.status).toBe(200)
    expect(created).toEqual([{ title: 'Task ta1', note: 'Details', actor: 'owner' }])
    expect(added).toEqual([{ from: tasks[0].iri, kind: 'resource', to: 'http://purl.org/stuff/dim/page/task-ta1', actor: 'owner' }])
    expect((await post('news')).status).toBe(400)
  })
})

describe('move a note into a task', () => {
  const PAGE = 'http://purl.org/stuff/dim/page/groceries'
  const NODE = 'http://purl.org/stuff/dim/node/n1'
  async function setup ({ failCreate = false } = {}) {
    const made = []
    const discarded = []
    const added = []
    const store = { ...stubStore([]), async create (fields, actor) { if (failCreate) throw new Error('nope'); made.push({ fields, actor }); return task('tnew1', { ...fields, iri: 'http://purl.org/stuff/dim/task/tnew1' }) } }
    const note = (id, iri, found) => ({ id, label: id, routes () {}, async asTask (i) { return i === iri ? found : null }, async discard (a) { discarded.push([id, a.iri]) } })
    const wiki = note('wiki', PAGE, { title: 'Groceries', note: 'Milk', tags: ['home'] })
    const trestle = note('trestle', NODE, { title: 'Call Sam', note: 'Re: invoice\n\n- ask for terms', tags: [] })
    const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
    const links = { add: async a => { if (a.kind === 'mentions') throw new Error('derived'); added.push(a) }, linksOf: async () => [{ kind: 'related', direction: 'out', iri: 'http://purl.org/stuff/dim/bookmark/b' }, { kind: 'resource', direction: 'in', iri: 'http://purl.org/stuff/dim/task/tz' }, { kind: 'mentions', direction: 'in', iri: 'http://purl.org/stuff/dim/page/other' }], syncMentions: async () => {}, syncHashtags: async () => {} }
    const server = createServer({ facets: [createGnamgnamFacet({ search }), createFareloFacet({ store, rng: seeded(3) }), wiki, trestle], defaultFacet: 'farelo', services: { auth: new Auth({ token: TOKEN }), links } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const base = `http://localhost:${server.address().port}`
    const move = from => fetch(`${base}/farelo/tasks/from`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from }) })
    return { move, made, discarded, added }
  }

  it('turns a wiki page into a task, re-makes its links and deletes the page', async () => {
    const { move, made, discarded, added } = await setup()
    const res = await move(PAGE)
    expect(res.status).toBe(200)
    expect(made).toEqual([{ fields: { title: 'Groceries', note: 'Milk', tags: ['home'] }, actor: 'owner' }])
    expect(added.map(a => [a.from, a.kind, a.to])).toEqual([
      ['http://purl.org/stuff/dim/task/tnew1', 'related', 'http://purl.org/stuff/dim/bookmark/b'],
      ['http://purl.org/stuff/dim/task/tz', 'resource', 'http://purl.org/stuff/dim/task/tnew1']
    ])
    expect(discarded).toEqual([['wiki', PAGE]])
  })

  it('does the same from an outline item', async () => {
    const { move, made, discarded } = await setup()
    expect((await move(NODE)).status).toBe(200)
    expect(made[0].fields).toMatchObject({ title: 'Call Sam', note: 'Re: invoice\n\n- ask for terms' })
    expect(discarded).toEqual([['trestle', NODE]])
  })

  it('refuses what is not a note, and keeps the note when the task cannot be made', async () => {
    const plain = await setup()
    expect((await plain.move('http://purl.org/stuff/dim/bookmark/b')).status).toBe(422)
    expect((await plain.move('')).status).toBe(400)
    expect(plain.discarded).toEqual([])
    const failing = await setup({ failCreate: true })
    expect((await failing.move(PAGE)).status).toBeGreaterThanOrEqual(400)
    expect(failing.discarded).toEqual([])
  })
})
