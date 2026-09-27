import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { createFareloFacet } from '../../src/farelo/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

const P = 'http://purl.org/stuff/dim/'
const TOKEN = 'test-token-0123456789abcdef'
let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

describe('project hub', () => {
  it('gathers what is part of a project and what its tasks use', async () => {
    const { store: wiki } = memoryWiki()
    const page = await wiki.save({ title: 'Synth design notes', content: 'x', actor: 'o' })
    const tasks = [
      { id: 't0001', iri: `${P}task/t0001`, title: 'Build a synth', status: 'doing', isProject: true, created: '2026-09-01T00:00:00Z', modified: '2026-09-20T00:00:00Z', dependsOn: [], tags: [] },
      { id: 't0002', iri: `${P}task/t0002`, title: 'Solder the VCO', status: 'done', project: `${P}task/t0001`, created: '2026-09-02T00:00:00Z', doneAt: '2026-09-24T00:00:00Z', dependsOn: [], tags: [] },
      { id: 't0003', iri: `${P}task/t0003`, title: 'Design the VCF', status: 'todo', project: `${P}task/t0001`, created: '2026-09-03T00:00:00Z', dependsOn: [], tags: [] }
    ]
    const taskStore = { async list () { return tasks }, async get (id) { return tasks.find(t => t.id === id) ?? null }, async history () { return [] } }
    const links = {
      async linksOf (iri) {
        if (iri === `${P}task/t0001`) return [{ kind: 'partOf', direction: 'in', iri: page.iri }]
        if (iri === `${P}task/t0003`) return [{ kind: 'resource', direction: 'out', iri: `${P}bookmark/filters` }]
        return []
      }
    }
    const docs = new Map([[`${P}bookmark/filters`, { iri: `${P}bookmark/filters`, name: 'Filter circuits', url: 'https://e.org/f', linkStatus: 'ok', userTags: [] }]])
    const facets = [createGnamgnamFacet({ search: { documents: docs, index: { size: 0 }, async facets () { return {} } } }), createFareloFacet({ store: taskStore }), createWikiFacet({ store: wiki })]
    const server = createServer({ facets, defaultFacet: 'farelo', services: { auth: new Auth({ token: TOKEN }), links } })
    servers.push(server)
    await new Promise(resolve => server.listen(0, resolve))
    const html = await (await fetch(`http://localhost:${server.address().port}/farelo/task/t0001`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(html).toContain('<h2 id="hub-h">This project</h2>')
    expect(html).toMatch(/1 of 2 tasks done · last activity \d+ days? ago/)
    expect(html).toMatch(/<h3>Wiki<\/h3><ul><li><a href="\/wiki\/page\/synth-design-notes">Synth design notes<\/a>/)
    expect(html).toMatch(/Used by its tasks<\/h3><h3>GnamGnam<\/h3><ul><li><a href="\/gnamgnam\/bookmark\/filters">Filter circuits/)
    expect(html).toContain(`<input type="hidden" name="to" value="${P}task/t0001"><input type="hidden" name="kind" value="partOf">`)
    const plain = await (await fetch(`http://localhost:${server.address().port}/farelo/task/t0003`)).text()
    expect(plain).not.toContain('This project')
  })
})
