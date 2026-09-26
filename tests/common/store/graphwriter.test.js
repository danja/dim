import { describe, it, expect } from 'vitest'
import GraphWriter, { termToSparql } from '../../../src/common/store/GraphWriter.js'

function stubClient () {
  const updates = []
  return { updates, async update (query) { updates.push(query) } }
}

const triple = n => `<urn:s${n}> <urn:p> "${n}" .`

describe('GraphWriter', () => {
  it('never splits a group across two INSERTs', async () => {
    const client = stubClient()
    const writer = new GraphWriter(client, { registry: {}, batchSize: 4 })
    const groups = [[triple(1), triple(2), triple(3)], [triple(4), triple(5)], [triple(6)]]
    expect(await writer.writeGrouped('urn:g', groups)).toBe(6)
    expect(client.updates).toHaveLength(2)
    expect(client.updates[0]).toMatch('"3"')
    expect(client.updates[0]).not.toMatch('"4"')
    expect(client.updates[1]).toMatch('"4"')
  })

  it('writes nothing for no groups', async () => {
    const client = stubClient()
    expect(await new GraphWriter(client, { registry: {} }).writeGrouped('urn:g', [])).toBe(0)
    expect(client.updates).toHaveLength(0)
  })

  it('formats RDF/JS terms', () => {
    expect(termToSparql({ termType: 'NamedNode', value: 'urn:x' })).toBe('<urn:x>')
    expect(termToSparql({ termType: 'Literal', value: 'hi', language: 'en' })).toBe('"hi"@en')
    expect(() => termToSparql({ termType: 'Variable', value: 'v' })).toThrow(/Variable/)
  })
})
