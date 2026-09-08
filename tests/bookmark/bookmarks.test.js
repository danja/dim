import { describe, it, expect } from 'vitest'
import { parseWorkflowy, deduplicate } from '../../src/harvest/WorkflowyParser.js'
import { classifyUrl, normaliseBookmark } from '../../src/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../../src/harvest/BookmarkSerialiser.js'
import { URIMinter } from '../../src/rdf/URIMinter.js'
import { composeText } from '../../src/embeddings/EmbeddingService.js'

describe('workflowy parser', () => {
  it('extracts markdown links with text and line numbers', () => {
    const rows = parseWorkflowy('- [GitHub - foo/bar](https://github.com/foo/bar)\n- plain\n')
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe('https://github.com/foo/bar')
    expect(rows[0].linkText).toBe('GitHub - foo/bar')
    expect(rows[0].sourceLine).toBe(1)
  })

  it('deduplicates by URL, keeping first link text', () => {
    const rows = deduplicate([
      { url: 'https://example.com/a', linkText: 'A', context: null, sourceLine: 1 },
      { url: 'https://example.com/a', linkText: '', context: 'ctx', sourceLine: 5 }
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].linkText).toBe('A')
    expect(rows[0].occurrences).toBe(2)
  })
})

describe('first-pass classification', () => {
  it('identifies github repos, arxiv papers, wikipedia', () => {
    expect(classifyUrl('https://github.com/foo/bar').join(' ')).toMatch('github-repo')
    expect(classifyUrl('https://arxiv.org/abs/2608.26263').join(' ')).toMatch('arxiv-paper')
    expect(classifyUrl('https://en.wikipedia.org/wiki/Krar').join(' ')).toMatch('wikipedia-article')
  })

  it('falls back to webpage, never empty', () => {
    expect(classifyUrl('https://example.com/some/page')).toHaveLength(1)
  })
})

describe('bookmark minting + serialisation', () => {
  it('mints one IRI per URL (idempotent)', () => {
    const minter = new URIMinter()
    const a = minter.mintBookmark({ url: 'https://github.com/foo/bar/', linkText: 'x' })
    const b = minter.mintBookmark({ url: 'https://github.com/foo/bar', linkText: 'y' })
    expect(a).toBe(b)
  })

  it('serialises a normalised bookmark to triples with dim:url', () => {
    const b = normaliseBookmark({ url: 'https://github.com/foo/bar', linkText: 'Foo' })
    const triples = serialiseBookmark(b, 'http://purl.org/stuff/dim/bookmark/foo-12345678')
    expect(triples.join('\n')).toMatch('http://purl.org/stuff/dim/Bookmark')
    expect(triples.join('\n')).toMatch('http://purl.org/stuff/dim/url')
    expect(composeText(b)).toMatch('github.com')
  })
})
