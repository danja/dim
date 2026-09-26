import { describe, it, expect } from 'vitest'
import ShapeValidator from '../../../src/common/store/ShapeValidator.js'
import { normaliseBookmark } from '../../../src/gnamgnam/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../../../src/gnamgnam/harvest/BookmarkSerialiser.js'

describe('shapes reject what they claim to', () => {
  it('a bookmark without dim:url does not conform', async () => {
    const validator = await ShapeValidator.load()
    const b = normaliseBookmark({ url: 'https://example.com/x', linkText: 'X' })
    const good = serialiseBookmark(b, 'http://purl.org/stuff/dim/bookmark/x-12345678')
    expect((await validator.validateTriples(good)).conforms).toBe(true)
    const bad = good.filter(t => !t.includes('/dim/url'))
    expect((await validator.validateTriples(bad)).conforms).toBe(false)
  })

  it('non-standard three-digit statuses conform (LinkedIn answers 999)', async () => {
    const validator = await ShapeValidator.load()
    const iri = 'http://purl.org/stuff/dim/bookmark/linkedin-12345678'
    const b = normaliseBookmark({ url: 'https://www.linkedin.com/in/danja', httpStatus: 999 })
    expect(b.httpStatus).toBe(999)
    expect((await validator.validateTriples(serialiseBookmark(b, iri))).conforms).toBe(true)
    const bad = serialiseBookmark(b, iri).map(t => t.replace('"999"', '"1000"'))
    expect((await validator.validateTriples(bad)).conforms).toBe(false)
  })

  it('the normaliser drops codes that are not three digits', () => {
    for (const junk of [0, 42, 1000, 'x', '', 99.5]) {
      expect(normaliseBookmark({ url: 'https://example.com/', httpStatus: junk }).httpStatus, String(junk)).toBeNull()
    }
    expect(normaliseBookmark({ url: 'https://example.com/', httpStatus: '404' }).httpStatus).toBe(404)
  })
})
