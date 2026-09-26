import { describe, it, expect } from 'vitest'
import GraphRegistry from '../../../src/common/store/GraphRegistry.js'

describe('GraphRegistry graph kinds', () => {
  it('mints one graph per facet', () => {
    expect(GraphRegistry.graphIri('facet', 'farelo')).toBe('graph:facet/farelo')
    expect(GraphRegistry.precedenceOf('facet')).toBe(GraphRegistry.precedenceOf('user'))
  })

  it('still mints source graphs', () => {
    expect(GraphRegistry.graphIri('source', 'workflowy')).toBe('graph:source/workflowy')
  })

  it('rejects unknown kinds and bad ids', () => {
    expect(() => GraphRegistry.graphIri('nope', 'x')).toThrow(/Unknown graph kind/)
    expect(() => GraphRegistry.graphIri('facet', 'Bad Id')).toThrow(/lowercase/)
  })
})
