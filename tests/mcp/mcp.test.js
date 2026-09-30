import { describe, it, expect, afterEach } from 'vitest'
import { createServer, createRouter } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createFacets } from '../../src/facets.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'
import { CATALOG } from '../../src/mcp/catalog.js'
import { htmlText } from '../../src/mcp/htmlText.js'

const TOKEN = 'test-token-0123456789abcdef'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

let servers = []
async function listen () {
  const { store } = memoryWiki()
  const links = { async syncMentions () {}, async linksOf () { return [] } }
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const facets = [createGnamgnamFacet({ search }), createWikiFacet({ store })]
  const server = createServer({ facets, defaultFacet: 'wiki', services: { auth: new Auth({ token: TOKEN }), links } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return `http://localhost:${server.address().port}`
}
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})

let nextId = 1
const rpc = (base, method, params, headers = AUTH) =>
  fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }) })
const call = async (base, name, args) => (await (await rpc(base, 'tools/call', { name, arguments: args })).json()).result

describe('MCP endpoint', () => {
  it('needs the token, never a session cookie, and refuses other origins', async () => {
    const base = await listen()
    expect((await rpc(base, 'ping', {}, { 'Content-Type': 'application/json' })).status).toBe(401)
    expect((await rpc(base, 'ping', {}, { ...AUTH, Authorization: 'Bearer wrong-wrong-wrong-wrong' })).status).toBe(401)
    expect((await rpc(base, 'ping', {}, { ...AUTH, Origin: 'https://evil.example' })).status).toBe(403)
    expect((await fetch(`${base}/mcp`, { headers: AUTH })).status).toBe(405)
    const off = createServer({ facets: [createGnamgnamFacet({ search: { documents: new Map(), index: { size: 0 } } })], defaultFacet: 'gnamgnam' })
    servers.push(off)
    await new Promise(resolve => off.listen(0, resolve))
    expect((await rpc(`http://localhost:${off.address().port}`, 'ping', {})).status).toBe(403)
  })

  it('initialises, lists tools and answers notifications with 202', async () => {
    const base = await listen()
    const init = await (await rpc(base, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json()
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'dim' } })
    const listed = (await (await rpc(base, 'tools/list')).json()).result.tools
    expect(listed.map(t => t.name)).toEqual(['dim_search', 'dim_get', 'dim_write', 'dim_endpoints'])
    expect(listed.every(t => t.inputSchema.type === 'object' && !('run' in t))).toBe(true)
    const note = await fetch(`${base}/mcp`, { method: 'POST', headers: AUTH, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(note.status).toBe(202)
    expect((await (await rpc(base, 'nope')).json()).error.code).toBe(-32601)
    expect((await (await rpc(base, 'tools/call', { name: 'nope' })).json()).error.code).toBe(-32602)
  })

  it('writes and reads through the same routes a person uses', async () => {
    const base = await listen()
    const saved = await call(base, 'dim_write', { path: '/wiki/page/home', body: { title: 'Home', content: 'Hello [[Elsewhere]]', base: 0 } })
    expect(saved.isError).toBeUndefined()
    expect(JSON.parse(saved.content[0].text)).toMatchObject({ ok: true, revision: 1 })

    expect((await call(base, 'dim_get', { path: '/wiki/page/home.md' })).content[0].text).toBe('Hello [[Elsewhere]]')
    const page = (await call(base, 'dim_get', { path: '/wiki/page/home' })).content[0].text
    expect(page).toContain('Hello')
    expect(page).not.toContain('<')
    const found = (await call(base, 'dim_search', { q: 'home' })).content[0].text
    expect(found).toContain('/wiki/page/home')

    // Errors come back as tool errors, with the status.
    const stale = await call(base, 'dim_write', { path: '/wiki/page/home', body: { title: 'Home', content: 'x', base: 0 } })
    expect(stale.isError).toBe(true)
    expect(stale.content[0].text).toMatch(/^HTTP 409/)
  })

  it('will not be used to log in, out or reach itself, or leave the server', async () => {
    const base = await listen()
    for (const path of ['/login', '/logout', '/mcp', '//evil.example/x', 'http://evil.example/']) {
      const r = await call(base, 'dim_write', { path, body: {} })
      expect(r.isError).toBe(true)
    }
  })

  it('dim_endpoints lists the catalog, filtered', async () => {
    const base = await listen()
    const all = (await call(base, 'dim_endpoints', {})).content[0].text
    expect(all).toContain('POST /farelo/tasks')
    const tasks = (await call(base, 'dim_endpoints', { method: 'POST', filter: 'farelo' })).content[0].text
    expect(tasks).toContain('/farelo/tasks')
    expect(tasks).not.toContain('/wiki/')
  })
})

describe('catalog', () => {
  const stub = {}
  const { router } = createRouter({
    facets: createFacets({
      search: { documents: new Map(), index: { size: 0 } },
      outlines: stub,
      tasks: stub,
      rolls: stub,
      wiki: stub,
      news: { store: stub, poller: stub, inbox: stub },
      blog: { store: stub, title: 'Blog', author: 'me' },
      client: stub,
      advisor: stub
    }),
    defaultFacet: 'gnamgnam'
  })

  it('lists every write route, and only routes that exist', () => {
    const skip = /^\/(login|logout|mcp)$/
    for (const route of router.routes.filter(rt => rt.methods.has('POST'))) {
      const listed = CATALOG.some(e => e.method === 'POST' && (typeof route.pattern === 'string' ? e.example === route.pattern : route.pattern.test(e.example)))
      const isSkipped = typeof route.pattern === 'string' && skip.test(route.pattern)
      expect(listed || isSkipped, `write route ${route.pattern} is not in src/mcp/catalog.js`).toBe(true)
    }
    for (const e of CATALOG) {
      const path = e.example.split('?')[0]
      const found = router.match(e.method, path)
      expect(found && !found.methodNotAllowed, `${e.method} ${path} matches no route`).toBeTruthy()
    }
  })
})

describe('htmlText', () => {
  it('keeps the main content and shows links', () => {
    const text = htmlText('<nav>Tabs</nav><main><h1>A &amp; B</h1><p>See <a href="/x">this</a>.</p><script>bad()</script></main><footer>f</footer>')
    expect(text).toBe('A & B\nSee this (/x).')
  })
})
