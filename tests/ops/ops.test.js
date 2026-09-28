import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { backup, restore, restoreGraphs, listBackups, latestBackup, stamp } from '../../src/common/ops/backup.js'
import { graphCounts, graphsAsNTriples, matchGraphs, compareCounts, DEFAULT_GRAPH } from '../../src/common/ops/backupGraphs.js'
import { jsonLine } from '../../src/common/logging.js'
import { createServer } from '../../src/server.js'
import Auth from '../../src/common/http/auth.js'
import { createGnamgnamFacet } from '../../src/gnamgnam/index.js'
import { createWikiFacet } from '../../src/wiki/index.js'
import { memoryWiki } from '../wiki/memoryWiki.js'

const TRIG = '<graph:facet/wiki> { <http://purl.org/stuff/dim/page/a> <http://purl.org/dc/terms/title> "A" . }\n'

function tmp () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dim-ops-'))
}

describe('backup and restore', () => {
  it('writes the store, data files and manifest; prunes; restores after checking the checksum', async () => {
    const root = tmp()
    const work = tmp()
    fs.writeFileSync(path.join(work, 'dim.index'), 'VECTORS')
    fs.writeFileSync(path.join(work, 'dim.index.json'), '{"ids":[]}')
    fs.writeFileSync(path.join(work, 'related.state.json'), '{}')
    const data = ['dim.index', 'dim.index.json', 'related.index', 'related.state.json'].map(f => path.join(work, f))
    const calls = []
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body })
      return init.method === 'PUT' ? new Response(null, { status: 204 }) : new Response(TRIG, { status: 200 })
    }
    const made = []
    for (let i = 0; i < 3; i++) {
      made.push(await backup({ dataUrl: 'http://store/dim/data', authHeader: 'Basic x', root, keep: 2, files: { data }, fetchImpl, now: new Date(Date.UTC(2026, 8, 26, 10, 0, i)) }))
    }
    expect(calls[0]).toMatchObject({ url: 'http://store/dim/data', method: 'GET', headers: { Accept: 'application/trig', Authorization: 'Basic x' } })
    expect(listBackups(root).map(d => path.basename(d))).toEqual(['20260926-100002Z', '20260926-100001Z'])
    expect(made[2].removed.map(d => path.basename(d))).toEqual(['20260926-100000Z'])
    const dir = made[2].dir
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'store.trig.gz'))).toString()).toBe(TRIG)
    expect(made[2].manifest.files).toEqual({ store: 'store.trig.gz', data: ['dim.index', 'dim.index.json', 'related.state.json'] }) // related.index wasn't there
    expect(latestBackup(root, new Date(Date.UTC(2026, 8, 26, 16, 0, 2)))).toMatchObject({ latest: '20260926-100002Z', hours: 6 })
    expect(latestBackup(tmp())).toBeNull()
    await backup({ dataUrl: 'http://store/dim/data', root, keep: 5, label: 'pre-restore', fetchImpl, now: new Date(Date.UTC(2026, 8, 26, 12)) })
    expect(latestBackup(root).latest).toBe('20260926-100002Z') // a safety copy isn't a scheduled backup

    fs.writeFileSync(path.join(work, 'dim.index'), 'CHANGED')
    const done = await restore({ dir, dataUrl: 'http://store/dim/data', dataDir: work, fetchImpl })
    expect(done.restored).toEqual(['store', 'dim.index', 'dim.index.json', 'related.state.json'])
    const put = calls.at(-1)
    expect(put).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/trig' } })
    expect(put.body.toString()).toBe(TRIG)
    expect(fs.readFileSync(path.join(work, 'dim.index'), 'utf8')).toBe('VECTORS')

    fs.writeFileSync(path.join(dir, 'store.trig.gz'), zlib.gzipSync('tampered'))
    await expect(restore({ dir, dataUrl: 'http://store/dim/data', fetchImpl })).rejects.toThrow('checksum')
    await expect(restore({ dir: work, dataUrl: 'x', fetchImpl })).rejects.toThrow('not a DIM backup')
    expect(stamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102-030405Z')
  })

  it('restores backups made before data files were listed (bookmark index only)', async () => {
    const dir = tmp()
    const work = tmp()
    fs.mkdirSync(path.join(dir, 'index'))
    fs.writeFileSync(path.join(dir, 'index', 'dim.index'), 'OLD')
    fs.writeFileSync(path.join(dir, 'index', 'dim.index.json'), '{}')
    fs.writeFileSync(path.join(dir, 'store.trig.gz'), zlib.gzipSync(TRIG))
    const { createHash } = await import('crypto')
    const sum = createHash('sha256').update(fs.readFileSync(path.join(dir, 'store.trig.gz'))).digest('hex')
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ tool: 'dim-backup', createdAt: '2026-09-26T00:00:00Z', files: { store: 'store.trig.gz', index: 'index/dim.index' }, storeSha256: sum }))
    const fetchImpl = async () => new Response(null, { status: 204 })
    expect((await restore({ dir, dataUrl: 'x', dataDir: work, fetchImpl })).restored).toEqual(['store', 'dim.index', 'dim.index.json'])
    expect(fs.readFileSync(path.join(work, 'dim.index'), 'utf8')).toBe('OLD')
  })
})

const MIXED = `@prefix dc: <http://purl.org/dc/terms/> .
<graph:facet/wiki> { <http://ex/a> dc:title "Tab\\there \\"quoted\\""@en ; dc:date "2026-09-27"^^<http://www.w3.org/2001/XMLSchema#date> . _:b dc:title "blank" . }
<graph:facet/news> { <http://ex/n> dc:title "news" . }
<graph:source/news> { <http://ex/f> dc:title "feed" . <http://ex/g> dc:title "feed 2" . }
<http://ex/default> dc:title "in the default graph" .
`

describe('looking inside a backup', () => {
  it('counts triples per graph and matches graph names', async () => {
    const counts = await graphCounts(MIXED)
    expect(Object.fromEntries(counts)).toEqual({ 'graph:facet/wiki': 3, 'graph:facet/news': 1, 'graph:source/news': 2, [DEFAULT_GRAPH]: 1 })
    const graphs = [...counts.keys()]
    expect(matchGraphs('wiki', graphs)).toEqual(['graph:facet/wiki'])
    expect(matchGraphs('news', graphs)).toEqual(['graph:facet/news', 'graph:source/news'])
    expect(matchGraphs('graph:source/news', graphs)).toEqual(['graph:source/news'])
    expect(matchGraphs('nothing', graphs)).toEqual([])
    expect(compareCounts(counts, new Map([['graph:facet/wiki', 5], ['graph:system/changes', 9]])).filter(r => r.graph.startsWith('graph:'))).toEqual([
      { graph: 'graph:facet/news', backup: 1, live: 0 },
      { graph: 'graph:facet/wiki', backup: 3, live: 5 },
      { graph: 'graph:source/news', backup: 2, live: 0 },
      { graph: 'graph:system/changes', backup: 0, live: 9 }
    ])
  })

  it('puts back only the graphs asked for, as N-Triples that parse back to the same', async () => {
    const nt = await graphsAsNTriples(MIXED, ['graph:facet/wiki'])
    const text = nt.get('graph:facet/wiki')
    expect(text).toContain('"Tab\\there \\"quoted\\""@en')
    expect(text).toContain('"2026-09-27"^^<http://www.w3.org/2001/XMLSchema#date>')
    expect(Object.fromEntries(await graphCounts(`<graph:facet/wiki> { ${text} }`))).toEqual({ 'graph:facet/wiki': 3 })

    const root = tmp()
    const puts = []
    const fetchImpl = async (url, init = {}) => {
      if (init.method === 'PUT') { puts.push({ url, type: init.headers['Content-Type'], body: init.body }); return new Response(null, { status: 204 }) }
      return new Response(MIXED, { status: 200 })
    }
    const { dir } = await backup({ dataUrl: 'http://store/dim/data', root, fetchImpl })
    const done = await restoreGraphs({ dir, graphs: ['graph:facet/news', 'graph:source/news'], dataUrl: 'http://store/dim/data', fetchImpl })
    expect(done).toEqual([{ graph: 'graph:facet/news', triples: 1 }, { graph: 'graph:source/news', triples: 2 }])
    expect(puts.map(p => [p.url, p.type])).toEqual([
      ['http://store/dim/data?graph=graph%3Afacet%2Fnews', 'application/n-triples'],
      ['http://store/dim/data?graph=graph%3Asource%2Fnews', 'application/n-triples']
    ])
  })
})

describe('logging', () => {
  it('writes JSON lines with fields and stacks', () => {
    const line = JSON.parse(jsonLine('info', [{ method: 'GET', status: 200 }, 'GET / 200'], new Date('2026-09-26T00:00:00Z')))
    expect(line).toEqual({ time: '2026-09-26T00:00:00.000Z', level: 'info', method: 'GET', status: 200, msg: 'GET / 200' })
    expect(JSON.parse(jsonLine('error', [new Error('boom')])).stack).toContain('boom')
  })
})

const TOKEN = 'test-token-0123456789abcdef'
let servers = []
afterEach(async () => {
  for (const s of servers) await new Promise(resolve => s.close(resolve))
  servers = []
})
async function listen (auth) {
  const search = { documents: new Map(), index: { size: 0 }, async facets () { return {} } }
  const server = createServer({ facets: [createGnamgnamFacet({ search }), createWikiFacet({ store: memoryWiki().store })], defaultFacet: 'wiki', services: { auth } })
  servers.push(server)
  await new Promise(resolve => server.listen(0, resolve))
  return `http://localhost:${server.address().port}`
}

describe('hardening', () => {
  it('sends security headers and keeps personal data out of shared caches', async () => {
    const base = await listen(new Auth({ token: TOKEN }))
    const page = await fetch(`${base}/wiki/`)
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('cache-control')).toBe('private, no-cache')
    expect(page.headers.get('access-control-allow-origin')).toBeNull()
    const json = await fetch(`${base}/health`)
    expect(json.headers.get('cache-control')).toBe('private, no-cache')
    expect((await json.json()).private).toBe(false)
  })

  it('in private mode, asks strangers to log in for everything but the essentials', async () => {
    const auth = new Auth({ token: TOKEN, privateReads: true })
    const base = await listen(auth)
    const page = await fetch(`${base}/wiki/`, { headers: { Accept: 'text/html' }, redirect: 'manual' })
    expect(page.status).toBe(303)
    expect(page.headers.get('location')).toBe('/login?return=%2Fwiki%2F')
    expect((await fetch(`${base}/wiki/page/x.json`)).status).toBe(401)
    expect((await fetch(`${base}/find.json?q=a`)).status).toBe(401)
    expect((await fetch(`${base}/login`)).status).toBe(200)
    expect((await fetch(`${base}/static/css/base.css`)).status).toBe(200)
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok' })
    const owner = await fetch(`${base}/wiki/`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(owner.status).toBe(200)
    expect(() => new Auth({ privateReads: true })).toThrow('DIM_WRITE_TOKEN')
    expect(Auth.fromEnv({ DIM_WRITE_TOKEN: TOKEN, DIM_ORIGIN: 'https://dim.example', DIM_PRIVATE: '1' })).toMatchObject({ secureCookie: true, privateReads: true })
  })

  it('offers to carry on read-only from the login page, unless reads are private', async () => {
    const open = await (await fetch(`${await listen(new Auth({ token: TOKEN }))}/login?return=%2Fwiki%2F`)).text()
    expect(open).toContain('<a class="button secondary" href="/wiki/">Ignore — continue read-only</a>')
    const closed = await (await fetch(`${await listen(new Auth({ token: TOKEN, privateReads: true }))}/login?return=%2Fwiki%2F`)).text()
    expect(closed).not.toContain('Ignore')
    expect(closed).toContain('DIM_PRIVATE')
  })
})
