import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createFareloFacet } from '../../src/farelo/index.js'
import { createSquirtFacet } from '../../src/squirt/index.js'
import { Advisor } from '../../src/advisor/Advisor.js'
import { NOW, memoryAdvisorStores } from './fixture.js'

const TOKEN = 'test-token-0123456789abcdef'
let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

async function listen () {
  const { taskStore, advice, moved } = memoryAdvisorStores()
  const advisor = new Advisor({ tasks: taskStore, advice, now: () => NOW })
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createFareloFacet({ store: { ...taskStore, async history () { return [] } }, advisor }), createSquirtFacet({ advisor })]
  const server = createServer({ facets, defaultFacet: 'farelo', services: { auth: new Auth({ token: TOKEN }) } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return { base: `http://localhost:${server.address().port}`, advice, moved }
}

describe('/farelo/next', () => {
  it('shows suggestions with their reasons, and takes feedback', async () => {
    const { base, advice, moved } = await listen()
    const html = await (await fetch(`${base}/farelo/next?minutes=30&context=@desk`)).text()
    expect(html).toContain('What next?')
    expect(html).toMatch(/File the tax return[\s\S]*priority 1/)
    expect(html).toContain('needs ~90 min, more than 30')
    expect(html).toContain('How suggestions are scored')
    expect(html).not.toContain('Do this now') // not logged in

    const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' }
    const skip = await fetch(`${base}/farelo/next/tax/skip`, { method: 'POST', headers: auth, body: JSON.stringify({ rank: 1 }) })
    expect(skip.status).toBe(200)
    expect(advice.records[0]).toMatchObject({ action: 'skip', rank: 1 })
    const accept = await (await fetch(`${base}/farelo/next/glue/accept`, { method: 'POST', headers: auth, body: JSON.stringify({ shown: 'vco,tax,old,glue' }) })).json()
    expect(accept).toEqual({ ok: true, id: 'glue', status: 'doing' })
    expect(moved).toEqual([['glue', 'doing']])

    const owner = await (await fetch(`${base}/squirt/`, { headers: { Authorization: `Bearer ${TOKEN}` } })).text()
    expect(owner).toContain('Next up')
  })
})
