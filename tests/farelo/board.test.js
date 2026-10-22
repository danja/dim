import { describe, it, expect } from 'vitest'
import { renderBoard } from '../../src/farelo/api/boardPage.js'

const task = { id: 'ta1', iri: 'http://purl.org/stuff/dim/task/ta1', title: 'Fix <b>it</b>', note: 'a "note"', status: 'todo', priority: 2, due: '2026-11-01', dependsOn: [], tags: [] }

describe('board quick edit', () => {
  const html = session => renderBoard({ tasks: [task], tabs: [], session })

  it('puts an edit form on each card for the owner, posting back to the board', () => {
    const out = html({ user: 'owner', csrf: 'c', writesEnabled: true })
    expect(out).toContain('<details class="card-edit"><summary>Edit</summary><form method="post" action="/farelo/task/ta1">')
    expect(out).toContain('name="_return" value="/farelo/"')
    expect(out).toContain('value="Fix &lt;b&gt;it&lt;/b&gt;"')
    expect(out).toContain('value="2026-11-01"')
    expect(out).toMatch(/<option value="2" selected>P2<\/option>/)
  })

  it('has none for a visitor', () => {
    expect(html(null)).not.toContain('card-edit')
  })
})
