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
})
