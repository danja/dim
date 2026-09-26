import { describe, it, expect } from 'vitest'
import { childrenOf, positionBetween, needsRenumber, insertPlace, planMove, subtree, ancestors, toMarkdown } from '../../src/trestle/tree.js'
import { planImport } from '../../src/trestle/importOutline.js'
import { decimalLiteral, nodeTriples, outlineIri } from '../../src/trestle/rdf.js'
import ShapeValidator from '../../src/common/store/ShapeValidator.js'

const O = 'urn:outline'
function outline (spec) {
  // spec: [id, parentId|null, position, title]
  const nodes = new Map()
  for (const [id, parent, position, title] of spec) {
    nodes.set(id, { id, iri: `urn:${id}`, parent: parent ? `urn:${parent}` : O, position, title: title ?? id })
  }
  return { iri: O, nodes }
}

const o = () => outline([
  ['a', null, 1], ['b', null, 2], ['c', null, 3],
  ['a1', 'a', 1], ['a2', 'a', 2],
  ['a21', 'a2', 1]
])

describe('outline tree', () => {
  it('orders children by position', () => {
    expect(childrenOf(o(), O).map(n => n.id)).toEqual(['a', 'b', 'c'])
  })

  it('finds positions between neighbours', () => {
    expect(positionBetween(null, null)).toBe(1)
    expect(positionBetween(1, 2)).toBe(1.5)
    expect(positionBetween(null, 1)).toBe(0)
    expect(positionBetween(3, null)).toBe(4)
    expect(needsRenumber(1, 1 + 1e-7)).toBe(true)
    expect(needsRenumber(1, 2)).toBe(false)
  })

  it('places new nodes after a sibling or at the end of a parent', () => {
    expect(insertPlace(o(), { after: 'a' })).toEqual({ parent: O, before: 1, after: 2 })
    expect(insertPlace(o(), { after: 'c' })).toEqual({ parent: O, before: 3, after: null })
    expect(insertPlace(o(), { parent: 'urn:a' })).toEqual({ parent: 'urn:a', before: 2, after: null })
  })

  it('plans indent, outdent, up and down', () => {
    const t = o()
    expect(planMove(t, t.nodes.get('b'), 'indent')).toMatchObject({ parent: 'urn:a', before: 2, after: null })
    expect(planMove(t, t.nodes.get('a'), 'indent')).toBeNull()
    expect(planMove(t, t.nodes.get('a2'), 'outdent')).toEqual({ parent: O, before: 1, after: 2 })
    expect(planMove(t, t.nodes.get('a'), 'outdent')).toBeNull()
    expect(planMove(t, t.nodes.get('c'), 'up')).toEqual({ parent: O, before: 1, after: 2 })
    expect(planMove(t, t.nodes.get('a'), 'up')).toBeNull()
    expect(planMove(t, t.nodes.get('a'), 'down')).toEqual({ parent: O, before: 2, after: 3 })
    expect(planMove(t, t.nodes.get('c'), 'down')).toBeNull()
    expect(() => planMove(t, t.nodes.get('a'), 'sideways')).toThrow(/Unknown move/)
  })

  it('walks subtrees and ancestors, and exports Markdown', () => {
    const t = o()
    expect(subtree(t, t.nodes.get('a')).map(n => n.id)).toEqual(['a', 'a1', 'a2', 'a21'])
    expect(ancestors(t, t.nodes.get('a21')).map(n => n.id)).toEqual(['a', 'a2'])
    expect(toMarkdown(t, O)).toBe('- a\n  - a1\n  - a2\n    - a21\n- b\n- c\n')
  })
})

describe('import and RDF', () => {
  it('plans an import: parents, positions, collapsed parents, URLs', () => {
    let n = 0
    const { nodes } = planImport('- A\n  - [x](https://x.example)\n- B\n', { outline: outlineIri('t'), newId: () => `n${++n}`, now: new Date(0) })
    expect(nodes.map(x => [x.id, x.parent.replace(/^.*\//, ''), x.position, x.collapsed])).toEqual([
      ['n1', 't', 1, true], ['n2', 'n1', 1, false], ['n3', 't', 2, false]
    ])
    expect(nodes[1].urls).toEqual(['https://x.example'])
  })

  it('writes decimals without exponents, and conforming nodes', async () => {
    expect(decimalLiteral(2)).toBe('"2.0"^^<http://www.w3.org/2001/XMLSchema#decimal>')
    expect(decimalLiteral(1e-7)).toBe('"0.0000001"^^<http://www.w3.org/2001/XMLSchema#decimal>')
    const validator = await ShapeValidator.load()
    const triples = nodeTriples({ iri: 'http://purl.org/stuff/dim/node/n1', outline: outlineIri('t'), parent: outlineIri('t'), position: 1.5, title: '', created: new Date(0), collapsed: true, line: 3 })
    expect((await validator.validateTriples(triples)).conforms).toBe(true)
    const noParent = triples.filter(t => !t.includes('/partOf>'))
    expect((await validator.validateTriples(noParent)).conforms).toBe(false)
  })
})
