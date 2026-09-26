import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { linkStatus } from '../../src/gnamgnam/LinkStatus.js'
import { bookmarkSearchAdapter } from '../../src/gnamgnam/BookmarkSearch.js'
import {
  availabilityUrl, parseAvailability, buildArchivePatchQuery, WaybackClient
} from '../../src/gnamgnam/deadlinks/Wayback.js'

describe('linkStatus', () => {
  it('classifies the last status seen', () => {
    expect(linkStatus({})).toBe('unchecked')
    expect(linkStatus({ httpStatus: '200' })).toBe('ok')
    expect(linkStatus({ httpStatus: 301 })).toBe('ok')
    expect(linkStatus({ httpStatus: 404 })).toBe('dead')
    expect(linkStatus({ httpStatus: 410 })).toBe('dead')
    expect(linkStatus({ httpStatus: 403 })).toBe('blocked')
    expect(linkStatus({ httpStatus: 429 })).toBe('blocked')
    expect(linkStatus({ httpStatus: 500 })).toBe('error')
    expect(linkStatus({ httpStatus: 999 })).toBe('blocked')
    expect(linkStatus({ httpStatus: 'junk' })).toBe('unchecked')
  })

  it('prefers the enrichment fetch over the first-pass probe', () => {
    expect(linkStatus({ httpStatus: 200, fetchStatus: 404 })).toBe('dead')
    expect(linkStatus({ httpStatus: 404, fetchStatus: 200 })).toBe('ok')
  })
})

describe('bookmark adapter link status', () => {
  const docs = [
    bookmarkSearchAdapter.toDocument({ bookmark: 'urn:a', url: 'https://a.example/', httpStatus: '404' }, null),
    bookmarkSearchAdapter.toDocument({ bookmark: 'urn:b', url: 'https://b.example/', httpStatus: '200' }, null),
    bookmarkSearchAdapter.toDocument({ bookmark: 'urn:c', url: 'https://c.example/' }, null)
  ]

  it('derives link status on each document', () => {
    expect(docs.map(d => d.linkStatus)).toEqual(['dead', 'ok', 'unchecked'])
    expect(docs[0].httpStatus).toBe(404)
  })

  it('counts and filters in memory', () => {
    expect(bookmarkSearchAdapter.documentFacets(docs).linkStatus).toEqual([
      { value: 'ok', count: 1 }, { value: 'dead', count: 1 }, { value: 'unchecked', count: 1 }
    ])
    const keep = bookmarkSearchAdapter.documentFilter({ linkStatus: 'dead' })
    expect(docs.filter(keep).map(d => d.iri)).toEqual(['urn:a'])
    expect(bookmarkSearchAdapter.documentFilter({})).toBeNull()
  })
})

describe('Wayback', () => {
  const reply = {
    archived_snapshots: {
      closest: { available: true, status: '200', timestamp: '20200101000000', url: 'http://web.archive.org/web/20200101000000/https://gone.example/' }
    }
  }

  it('builds the availability URL', () => {
    expect(availabilityUrl('https://x.example/a?b=1')).toBe('https://archive.org/wayback/available?url=https%3A%2F%2Fx.example%2Fa%3Fb%3D1')
  })

  it('parses the closest good snapshot as https', () => {
    expect(parseAvailability(reply)).toEqual({
      archivedUrl: 'https://web.archive.org/web/20200101000000/https://gone.example/',
      timestamp: '20200101000000'
    })
    expect(parseAvailability({ archived_snapshots: {} })).toBeNull()
    expect(parseAvailability({ archived_snapshots: { closest: { ...reply.archived_snapshots.closest, status: '404' } } })).toBeNull()
  })

  it('patches schema:archivedAt in the bookmark graph', () => {
    const q = buildArchivePatchQuery('urn:g', 'urn:b', 'https://web.archive.org/web/1/x')
    expect(q).toMatch('DELETE WHERE { GRAPH <urn:g> { <urn:b> <https://schema.org/archivedAt> ?old } }')
    expect(q).toMatch('INSERT DATA { GRAPH <urn:g> { <urn:b> <https://schema.org/archivedAt> <https://web.archive.org/web/1/x> . } }')
  })

  it('caches answers, including no snapshot', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dim-wayback-'))
    let calls = 0
    const fetchImpl = async (url) => {
      calls += 1
      const body = url.includes('gone') ? reply : { archived_snapshots: {} }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    const client = new WaybackClient({ cachePath: path.join(dir, 'w.json'), requestIntervalMs: 0, fetchImpl })
    expect((await client.lookup('https://gone.example/')).fromCache).toBe(false)
    expect((await client.lookup('https://never.example/')).archivedUrl).toBeNull()
    const again = new WaybackClient({ cachePath: path.join(dir, 'w.json'), requestIntervalMs: 0, fetchImpl })
    const hit = await again.lookup('https://gone.example/')
    expect(hit).toMatchObject({ fromCache: true, archivedUrl: expect.stringMatching(/^https:\/\/web\.archive\.org/) })
    expect((await again.lookup('https://never.example/')).fromCache).toBe(true)
    expect(calls).toBe(2)
  })

  it('does not cache API failures', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dim-wayback-'))
    const client = new WaybackClient({ cachePath: path.join(dir, 'w.json'), requestIntervalMs: 0, fetchImpl: async () => new Response('', { status: 503 }) })
    await expect(client.lookup('https://x.example/')).rejects.toThrow(/503/)
    expect(fs.existsSync(path.join(dir, 'w.json'))).toBe(false)
  })
})
