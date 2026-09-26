import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  extractKeywords, normaliseKeywords, buildMarkdown, parseStructuredReply,
  MechanicalSummariser, OllamaSummariser
} from '../../../src/gnamgnam/enrich/Summarisers.js'
import { enrichmentTriples } from '../../../src/gnamgnam/enrich/Writers.js'
import { normaliseBookmark } from '../../../src/gnamgnam/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../../../src/gnamgnam/harvest/BookmarkSerialiser.js'
import { composeText } from '../../../src/gnamgnam/BookmarkText.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('keyword extraction', () => {
  it('ranks frequent content words over stopwords', () => {
    const text = 'The synthesiser review covers synthesiser filters and synthesiser envelopes. A review of analogue synthesis.'
    const kws = extractKeywords(text, { max: 5 })
    expect(kws[0]).toBe('synthesiser')
    expect(kws).toContain('review')
    expect(kws).not.toContain('the')
    expect(kws).not.toContain('and')
  })

  it('drops short and numeric tokens', () => {
    expect(extractKeywords('ab 12 xyz xyz', { max: 5 })).toEqual(['xyz'])
  })

  it('normalises llm terms to unique lowercase', () => {
    expect(normaliseKeywords(['Drums', 'drums', 'A', '  Bass ', null], { max: 10 }))
      .toEqual(['drums', 'bass'])
  })
})

describe('markdown builder', () => {
  it('composes a fixed-shape document', () => {
    const md = buildMarkdown({
      title: 'Foo',
      url: 'https://example.com/foo',
      summary: 'A foo page.',
      keywords: ['foo', 'bar'],
      types: ['webpage']
    })
    expect(md).toMatch('# Foo')
    expect(md).toMatch('A foo page.')
    expect(md).toMatch('[example.com](https://example.com/foo)')
    expect(md).toMatch('Key terms: foo, bar')
  })

  it('survives missing fields', () => {
    expect(buildMarkdown({ url: 'https://example.com/x', summary: 'Hi.' })).toMatch('# https://example.com/x')
    expect(buildMarkdown({})).toBeNull()
  })
})

describe('mechanical summariser', () => {
  it('returns summary + keywords + markdown with no network', async () => {
    const s = new MechanicalSummariser()
    expect(s.id).toBe('mechanical-v1')
    const out = await s.summarise(
      'Drum synthesis shapes drum transients. Drum synthesis uses oscillators and noise. Filters shape the drum body.',
      { title: 'Drum synthesis', linkText: 'Drums', url: 'https://example.com/drums', bookmarkType: ['http://purl.org/stuff/dim/concept/webpage'] }
    )
    expect(out.summary).toMatch('Drum synthesis')
    expect(out.keywords[0]).toBe('drum')
    expect(out.markdown).toMatch('# Drums')
    expect(out.markdown).toMatch('Key terms:')
    expect(out.model).toBe('mechanical-v1')
  })

  it('returns null on empty text', async () => {
    expect(await new MechanicalSummariser().summarise('  ')).toBeNull()
  })
})

describe('ollama structured reply', () => {
  it('parses summary and key terms lines', () => {
    const parsed = parseStructuredReply('SUMMARY: A drum machine. It booms.\nKEY TERMS: drums, synthesis, analogue')
    expect(parsed.summary).toBe('A drum machine. It booms.')
    expect(parsed.keywords).toEqual(['drums', 'synthesis', 'analogue'])
  })

  it('falls back to whole text without the shape', () => {
    const parsed = parseStructuredReply('Just some prose here.')
    expect(parsed.summary).toBe('Just some prose here.')
  })

  it('summarise composes markdown locally and fills keywords mechanically', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ response: 'SUMMARY: Drum synthesis shapes transients.\nKEY TERMS: ' })
    }))
    const s = new OllamaSummariser({ baseUrl: 'http://localhost:11434', model: 'test-model' })
    const out = await s.summarise(
      'Drum synthesis shapes drum transients with oscillators.',
      { url: 'https://example.com/d', bookmarkType: [] }
    )
    expect(out.summary).toMatch('Drum synthesis')
    expect(out.keywords).toContain('drum')
    expect(out.markdown).toMatch('# https://example.com/d')
    expect(out.model).toMatch('ollama/test-model')
  })

  it('returns null when the model answers nothing usable', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ response: '   ' }) }))
    const s = new OllamaSummariser({ baseUrl: 'http://localhost:11434' })
    expect(await s.summarise('Some text here.', {})).toBeNull()
  })

  it('returns null on transport failure so the chain falls through', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('down') })
    const s = new OllamaSummariser({ baseUrl: 'http://localhost:11434' })
    expect(await s.summarise('Some text here.', {})).toBeNull()
  })
})

describe('keywords + markdown flow into rdf and embeddings', () => {
  it('triples carry keywords and markdown', () => {
    const triples = enrichmentTriples('http://purl.org/stuff/dim/bookmark/x', {
      summary: 'A thing.',
      summaryModel: 'mechanical-v1',
      summarisedAt: '2026-09-08T00:00:00.000Z',
      keywords: ['drums', 'synthesis'],
      markdown: '# Thing\n\nA thing.',
      contentHash: 'abcdef1234567890',
      contentLength: 42,
      fetchStatus: 200
    })
    const text = triples.join('\n')
    expect(text).toMatch('dim/keyword')
    expect(text).toMatch('dim/summaryMarkdown')
  })

  it('normalise → serialise → composeText carry keywords', () => {
    const b = normaliseBookmark({
      url: 'https://example.com/x',
      linkText: 'X',
      summary: 'A short summary.',
      summaryModel: 'mechanical-v1',
      keywords: ['Drums', 'drums', 'synthesis'],
      markdown: '# X\n\nA short summary.'
    })
    expect(b.keywords).toEqual(['drums', 'synthesis'])
    const triples = serialiseBookmark(b, 'http://purl.org/stuff/dim/bookmark/x-12345678')
    expect(triples.join('\n')).toMatch('dim/keyword')
    expect(composeText(b)).toMatch('drums, synthesis')
  })
})
