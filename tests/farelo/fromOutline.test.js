import { describe, it, expect } from 'vitest'
import { planTasks, isTodoHeading, isJustLink } from '../../src/farelo/fromOutline.js'
import { planImport } from '../../src/trestle/importOutline.js'
import { childrenOf } from '../../src/trestle/tree.js'

const MD = `- Notes
  - not a task
- **TODO**
  - Admin
    - check linode
    - [docs](https://example.com/docs)
  - Write the report
  - TODO 2013-11-27
    - Call Bob
  - https://example.org/just-a-link
- ToDo list
  - Call Bob
`

function outlineOf (md) {
  let n = 0
  const { nodes } = planImport(md, { outline: 'urn:o', newId: () => `n${++n}` })
  return { iri: 'urn:o', nodes: new Map(nodes.map(x => [x.id, x])) }
}

describe('tasks from outline TODO sections', () => {
  it('recognises TODO headings and link-only items', () => {
    for (const h of ['TODO', '**TODO**', 'Misc TODO', 'ToDo list', 'TODO 2013-11-27', 'to-do']) expect(isTodoHeading(h), h).toBe(true)
    for (const h of ['@TODO make a thing', 'Todos for Seki', 'Things to do']) expect(isTodoHeading(h), h).toBe(false)
    expect(isJustLink('[docs](https://example.com/docs)')).toBe(true)
    expect(isJustLink('https://example.org/x')).toBe(true)
    expect(isJustLink('read [docs](https://example.com)')).toBe(false)
  })

  it('turns children into tasks and grandchildren into project tasks', () => {
    const outline = outlineOf(MD)
    const plan = planTasks(outline, p => childrenOf(outline, p))
    expect(plan.map(p => [p.title, p.isProject, p.project?.title ?? null])).toEqual([
      ['Admin', true, null],
      ['check linode', false, 'Admin'],
      ['Write the report', false, null],
      ['Call Bob', false, null],
      ['Call Bob', false, null]
    ])
  })
})
