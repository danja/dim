import { describe, it, expect } from 'vitest'
import { backfillHashtags } from '../../src/common/hashtags/backfill.js'

const items = [
  { iri: 'a', texts: ['Notes on #synth and #music/synth', null] },
  { iri: 'b', texts: ['No tags here, issue #123'] },
  { iri: 'c', texts: ['title', '#synth again'] }
]

describe('backfillHashtags', () => {
  it('syncs only items that have tags and counts uses', async () => {
    const calls = []
    const links = { syncHashtags: async a => calls.push(a) }
    const report = await backfillHashtags(items, links)
    expect(calls).toEqual([
      { from: 'a', tags: ['synth', 'music/synth'], actor: 'backfill' },
      { from: 'c', tags: ['synth'], actor: 'backfill' }
    ])
    expect(report).toMatchObject({ items: 3, tagged: 2 })
    expect(report.tags.get('synth')).toBe(2)
  })

  it('writes nothing on a dry run', async () => {
    const links = { syncHashtags: async () => { throw new Error('no writes') } }
    expect((await backfillHashtags(items, links, { dryRun: true })).tagged).toBe(2)
  })
})
