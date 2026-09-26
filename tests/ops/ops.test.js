import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { backup, restore, listBackups, stamp } from '../../src/common/ops/backup.js'
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
  it('writes the store, index and manifest; prunes; restores after checking the checksum', async () => {
    const root = tmp()
    const work = tmp()
    fs.writeFileSync(path.join(work, 'dim.index'), 'VECTORS')
    fs.writeFileSync(path.join(work, 'dim.index.json'), '{"ids":[]}')
    const calls = []
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers, body: init.body })
      return init.method === 'PUT' ? new Response(null, { status: 204 }) : new Response(TRIG, { status: 200 })
    }
    const made = []
    for (let i = 0; i < 3; i++) {
      made.push(await backup({ dataUrl: 'http://store/dim/data', authHeader: 'Basic x', root, keep: 2, files: { index: path.join(work, 'dim.index') }, fetchImpl, now: new Date(Date.UTC(2026, 8, 26, 10, 0, i)) }))
    }
    expect(calls[0]).toMatchObject({ url: 'http://store/dim/data', method: 'GET', headers: { Accept: 'application/trig', Authorization: 'Basic x' } })
    expect(listBackups(root).map(d => path.basename(d))).toEqual(['20260926-100002Z', '20260926-100001Z'])
    expect(made[2].removed.map(d => path.basename(d))).toEqual(['20260926-100000Z'])
    const dir = made[2].dir
    expect(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'store.trig.gz'))).toString()).toBe(TRIG)
    expect(made[2].manifest.files).toEqual({ store: 'store.trig.gz', index: 'index/dim.index' })

    fs.writeFileSync(path.join(work, 'dim.index'), 'CHANGED')
    const done = await restore({ dir, dataUrl: 'http://store/dim/data', files: { index: path.join(work, 'dim.index') }, fetchImpl })
    expect(done.restored).toEqual(['store', 'index'])
    const put = calls.at(-1)
    expect(put).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/trig' } })
    expect(put.body.toString()).toBe(TRIG)
    expect(fs.readFileSync(path.join(work, 'dim.index'), 'utf8')).toBe('VECTORS')

    fs.writeFileSync(path.join(dir, 'store.trig.gz'), zlib.gzipSync('tampered'))
    await expect(restore({ dir, dataUrl: 'http://store/dim/data', fetchImpl })).rejects.toThrow('checksum')
    await expect(restore({ dir: work, dataUrl: 'x', fetchImpl })).rejects.toThrow('not a DIM backup')
    expect(stamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102-030405Z')
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
})
