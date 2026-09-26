import { describe, it, expect } from 'vitest'
import { NamespaceManager, NAMESPACES } from '../../../src/common/rdf/NamespaceManager.js'
import QueryService from '../../../src/common/store/QueryService.js'
import { LICENCES } from '../../../src/common/store/GraphRegistry.js'
import fs from 'fs'

describe('namespaces', () => {
  it('registers dim: and every query prefix resolves', () => {
    expect(NAMESPACES.dim).toBe('http://purl.org/stuff/dim/')
    const nm = new NamespaceManager()
    expect(nm.expand('dim:Bookmark')).toBe('http://purl.org/stuff/dim/Bookmark')
    const qs = new QueryService()
    for (const name of qs.list()) {
      const body = qs.template(name)
      for (const m of body.matchAll(/(^|[\s{(])([a-z][a-z0-9]*):/g)) {
        expect(Object.keys(NAMESPACES)).toContain(m[2])
      }
    }
  })
})

describe('shapes licence list matches registry', () => {
  it('every LICENCES key appears in shapes.ttl sh:in', () => {
    const shapes = fs.readFileSync('vocabs/shapes.ttl', 'utf8')
    for (const key of Object.keys(LICENCES)) {
      expect(shapes).toContain(`"${key}"`)
    }
  })
})
