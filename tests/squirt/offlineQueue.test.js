import { describe, it, expect } from 'vitest'
import { saveNews, loadNews, enqueue, queued, flush, noteOnItem, clearOffline, attempt } from '../../src/common/ui/public/js/offlineQueue.js'
import { classify } from '../../src/squirt/capture.js'

const memory = () => {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }
}

describe('offline news', () => {
  it('keeps the 10 newest, reduced to summaries', () => {
    const s = memory()
    const items = Array.from({ length: 15 }, (_, i) => ({ id: `i${i}`, title: `T${i}`, snippet: `S${i}`, href: `/news/item/i${i}`, link: null, junk: 'x' }))
    saveNews(s, items, () => new Date('2026-09-30T10:00:00Z'))
    const saved = loadNews(s)
    expect(saved.items).toHaveLength(10)
    expect(saved.items[0]).toEqual({ id: 'i0', title: 'T0', link: null, href: '/news/item/i0', published: null, summary: 'S0' })
    expect(saved.at).toBe('2026-09-30T10:00:00.000Z')
  })

  it('reads an empty or corrupt store as nothing', () => {
    const s = memory()
    expect(loadNews(s).items).toEqual([])
    s.setItem('dim.offline.news', '{bad')
    expect(loadNews(s).items).toEqual([])
  })
})

describe('offline queue', () => {
  it('turns a note on an item into a wiki note, not a bookmark', () => {
    const c = noteOnItem({ title: 'Big news', link: 'https://e.org/a' }, ' worth a look ')
    expect(classify(c)).toMatchObject({ kind: 'note', title: 'Re: Big news' })
  })

  it('flushes in order, stops when offline, drops refusals', async () => {
    const s = memory()
    for (const t of ['a', 'b', 'c', 'd']) enqueue(s, { text: t })
    const seen = []
    const result = await flush(s, async c => {
      seen.push(c.text)
      if (c.text === 'b') return { ok: false, status: 400 }
      if (c.text === 'd') throw new Error('offline')
      return { ok: true, status: 200 }
    })
    expect(seen).toEqual(['a', 'b', 'c', 'd'])
    expect(result).toEqual({ sent: 2, dropped: 1, left: 1 })
    expect(queued(s).map(c => c.text)).toEqual(['d'])
  })

  it('keeps the queue on an expired session or server error', async () => {
    const s = memory()
    enqueue(s, { text: 'a' })
    expect((await flush(s, async () => ({ ok: false, status: 403 }))).left).toBe(1)
    expect((await flush(s, async () => ({ ok: false, status: 503 }))).left).toBe(1)
  })

  it('clears on logout', () => {
    const s = memory()
    enqueue(s, { text: 'a' })
    saveNews(s, [])
    clearOffline(s)
    expect(queued(s)).toEqual([])
    expect(loadNews(s).items).toEqual([])
  })
})

describe('attempt', () => {
  const item = { text: 'https://example.org/', kind: 'bookmark' }

  it('sends straight away when the server answers', async () => {
    const s = memory()
    expect((await attempt(s, item, async () => ({ ok: true, status: 200 }))).state).toBe('sent')
    expect(queued(s)).toEqual([])
  })

  it('queues when the server is unreachable or answers 5xx/401', async () => {
    const s = memory()
    expect((await attempt(s, item, async () => { throw new TypeError('Failed to fetch') })).state).toBe('queued')
    expect((await attempt(s, item, async () => ({ ok: false, status: 502 }))).state).toBe('queued')
    expect((await attempt(s, item, async () => ({ ok: false, status: 401 }))).state).toBe('queued')
    expect(queued(s)).toHaveLength(3)
  })

  it('does not queue what the server refuses', async () => {
    const s = memory()
    expect((await attempt(s, item, async () => ({ ok: false, status: 400 }))).state).toBe('refused')
    expect(queued(s)).toEqual([])
  })

  it('syncs the queue once the server is back', async () => {
    const s = memory()
    await attempt(s, item, async () => { throw new TypeError('down') })
    expect(await flush(s, async () => ({ ok: true, status: 200 }))).toEqual({ sent: 1, dropped: 0, left: 0 })
  })
})
