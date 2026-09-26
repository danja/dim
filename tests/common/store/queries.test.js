import { describe, it, expect } from 'vitest'
import sparqljs from 'sparqljs'
import QueryService from '../../../src/common/store/QueryService.js'

/** Every named query must parse once its placeholders are filled. */
describe('named SPARQL queries', () => {
  const queries = new QueryService()
  const parser = new sparqljs.Parser()
  // Placeholders that take a SPARQL fragment rather than a single term.
  const SAMPLE = { conditions: '?bookmark ?p ?o .', optional: 'dim:harvestRun "r" .' }

  for (const name of queries.list()) {
    it(`${name} parses`, () => {
      const template = queries.template(name)
      const params = {}
      for (const [, key] of template.matchAll(/\$\{([a-zA-Z0-9_]+)\}/g)) params[key] = SAMPLE[key] ?? '<urn:x>'
      expect(() => parser.parse(queries.get(name, params))).not.toThrow()
    })
  }
})
