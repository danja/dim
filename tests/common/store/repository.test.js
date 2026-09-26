import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../../src/common/store/ShapeValidator.js'
import Repository, { splitTriple, bindingToTerm } from '../../../src/common/store/Repository.js'
import { changeTriples } from '../../../src/common/store/ChangeLog.js'
import { normaliseTags, normaliseNote, annotationTriples, TAG_PREDICATE, NOTE_PREDICATE } from '../../../src/gnamgnam/Annotations.js'

const S = 'http://purl.org/stuff/dim/bookmark/x-1'
const G = 'graph:facet/gnamgnam'

async function repo (current = []) {
  const updates = []
  const changes = []
  const client = {
    query: async () => ({ results: { bindings: current } }),
    update: async q => updates.push(q)
  }
  const registry = { constructor: { graphIri: (k, id) => `graph:${k}/${id}` }, isRegistered: async () => true }
  const repository = new Repository({ client, validator: await ShapeValidator.load(), changeLog: { record: async c => changes.push(c) }, registry })
  return { repository, updates, changes }
}

describe('Repository', () => {
  it('splits triples and reads bindings back as terms', () => {
    expect(splitTriple(`<${S}> <urn:p> "a b" .`)).toEqual({ s: `<${S}>`, p: 'urn:p', o: '"a b"' })
    expect(bindingToTerm({ type: 'uri', value: 'urn:x' })).toBe('<urn:x>')
    expect(bindingToTerm({ type: 'literal', value: 'hi', 'xml:lang': 'en' })).toBe('"hi"@en')
    expect(bindingToTerm({ type: 'literal', value: '5', datatype: 'http://www.w3.org/2001/XMLSchema#integer' })).toBe('"5"^^<http://www.w3.org/2001/XMLSchema#integer>')
    expect(bindingToTerm({ type: 'bnode', value: 'b0' })).toBeNull()
  })

  it('replaces owned properties, keeps others, and logs the change', async () => {
    const { repository, updates, changes } = await repo([
      { p: { type: 'uri', value: TAG_PREDICATE }, o: { type: 'literal', value: 'old' } },
      { p: { type: 'uri', value: 'urn:other' }, o: { type: 'literal', value: 'kept' } }
    ])
    const triples = annotationTriples(S, { tags: ['synth'], note: 'Hello' })
    await repository.replace({ graph: G, subject: S, predicates: [TAG_PREDICATE, NOTE_PREDICATE], triples, actor: 'owner' })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatch(/DELETE \{ GRAPH <graph:facet\/gnamgnam>/)
    expect(updates[0]).toMatch('"synth"')
    expect(changes[0]).toMatchObject({ actor: 'owner', action: 'update', subject: S })
  })

  it('rejects what the shapes reject, writing nothing', async () => {
    const { repository, updates, changes } = await repo()
    const bad = [`<${S}> <${TAG_PREDICATE}> "UPPER" .`]
    await expect(repository.replace({ graph: G, subject: S, predicates: [TAG_PREDICATE], triples: bad, actor: 'owner' }))
      .rejects.toMatchObject({ status: 422, violations: [expect.stringMatching(/lower-case/)] })
    expect(updates).toHaveLength(0)
    expect(changes).toHaveLength(0)
  })

  it('refuses triples about another subject or unowned properties', async () => {
    const { repository } = await repo()
    await expect(repository.replace({ graph: G, subject: S, predicates: [TAG_PREDICATE], triples: ['<urn:other> <urn:p> "x" .'] })).rejects.toThrow(/not about/)
    await expect(repository.replace({ graph: G, subject: S, predicates: [TAG_PREDICATE], triples: [`<${S}> <urn:p> "x" .`] })).rejects.toThrow(/does not own/)
  })

  it('records changes as prov activities', () => {
    const t = changeTriples({ id: 'c1', actor: 'owner', action: 'update', graph: G, subject: S, predicates: [TAG_PREDICATE], summary: 's', at: new Date(0) })
    expect(t.join('\n')).toMatch('http://www.w3.org/ns/prov#Activity')
    expect(t.join('\n')).toMatch(`<${TAG_PREDICATE}>`)
  })
})

describe('annotations', () => {
  it('normalises tags and notes', () => {
    expect(normaliseTags('Synth,  DIY ,,synth, Music  Theory')).toEqual(['synth', 'diy', 'music theory'])
    expect(normaliseTags(['A', 'b'])).toEqual(['a', 'b'])
    expect(() => normaliseTags(Array.from({ length: 21 }, (_, i) => `t${i}`))).toThrow(/20/)
    expect(() => normaliseTags('x'.repeat(61))).toThrow(/long/)
    expect(normaliseNote('  \r\n  ')).toBeNull()
    expect(normaliseNote('a\r\nb')).toBe('a\nb')
  })
})
