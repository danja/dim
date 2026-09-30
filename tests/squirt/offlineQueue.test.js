import { describe, it, expect } from 'vitest'
import { saveNews, loadNews, enqueue, queued, flush, noteOnItem, clearOffline } from '../../src/common/ui/public/js/offlineQueue.js'
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
