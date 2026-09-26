import { describe, it, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { contentHash } from '../../../src/gnamgnam/enrich/Fetchers.js'
import { GithubApiFetcher, ArxivFetcher, WikipediaFetcher } from '../../../src/gnamgnam/enrich/Fetchers.js'
import { HtmlExtractor, FallbackExtractor, cleanText } from '../../../src/gnamgnam/enrich/Extractors.js'
import { ExtractiveSummariser } from '../../../src/gnamgnam/enrich/Summarisers.js'
import { enrichmentTriples, buildEnrichmentPatchQuery, CacheWriter } from '../../../src/gnamgnam/enrich/Writers.js'
import { Enricher } from '../../../src/gnamgnam/enrich/Enricher.js'
import { defaultExtractors, defaultSummarisers } from '../../../src/gnamgnam/enrich/registry.js'
import { normaliseBookmark } from '../../../src/gnamgnam/harvest/BookmarkNormaliser.js'
import { serialiseBookmark } from '../../../src/gnamgnam/harvest/BookmarkSerialiser.js'
import { composeText } from '../../../src/common/embeddings/EmbeddingService.js'

describe('enricher plugin selection', () => {
  it('routes github/arxiv/wikipedia urls to site fetchers', () => {
    expect(new GithubApiFetcher().canHandle({ url: 'https://github.com/foo/bar' })).toBe(true)
    expect(new GithubApiFetcher().canHandle({ url: 'https://example.com/x' })).toBe(false)
    expect(new ArxivFetcher().canHandle({ url: 'https://arxiv.org/abs/2608.26263' })).toBe(true)
    expect(new WikipediaFetcher().canHandle({ url: 'https://en.wikipedia.org/wiki/Krar' })).toBe(true)
    expect(new WikipediaFetcher().canHandle({ url: 'https://example.com/x' })).toBe(false)
  })

  it('registry ends with fallbacks that handle anything', () => {
    const extractors = defaultExtractors()
    const last = extractors[extractors.length - 1]
    expect(last.canHandle({ url: 'https://example.com/anything' })).toBe(true)
    expect(defaultSummarisers('extractive')).toHaveLength(2)
    expect(defaultSummarisers('ollama')).toHaveLength(3)
    expect(defaultSummarisers('extractive')[0].id).toBe('mechanical-v1')
  })
})

describe('extractors', () => {
  it('html extractor strips scripts and keeps paragraphs', async () => {
    const html = '<html><head><title>T</title><script>evil()</script></head><body><nav>menu</nav><article><p>First paragraph here.</p><p>Second paragraph here.</p></article></body></html>'
    const out = await new HtmlExtractor().extract({ body: html, title: null, description: null })
    expect(out.text).toMatch('First paragraph')
    expect(out.text).not.toMatch('evil')
    expect(out.text).not.toMatch('menu')
    expect(out.title).toBe('T')
  })

  it('fallback never returns empty when title exists', async () => {
    const out = await new FallbackExtractor().extract({ body: null, title: 'Hello', description: null })
    expect(out.text).toMatch('Hello')
  })

  it('cleanText collapses whitespace and caps length', () => {
    expect(cleanText('  a   b \n c  ', 10)).toBe('a b c')
    expect(cleanText('x'.repeat(100), 10)).toHaveLength(10)
  })
})

describe('extractive summariser', () => {
  it('returns first sentences within budget', async () => {
    const s = new ExtractiveSummariser({ maxChars: 100 })
    const { summary, model } = await s.summarise('First sentence here. Second sentence here. Third sentence here. Fourth.')
    expect(summary.length).toBeLessThanOrEqual(100)
    expect(summary).toMatch('First sentence')
    expect(model).toBe('extractive-v1')
  })

  it('returns null on empty text', async () => {
    expect(await new ExtractiveSummariser().summarise('   ')).toBeNull()
  })
})

describe('content hash + patch query', () => {
  it('hash is stable 16-hex', () => {
    expect(contentHash('abc')).toBe(contentHash('abc'))
    expect(contentHash('abc')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('triples carry summary provenance', () => {
    const triples = enrichmentTriples('http://purl.org/stuff/dim/bookmark/x', {
      summary: 'A thing.',
      summaryModel: 'extractive-v1',
      summarisedAt: '2026-09-08T00:00:00.000Z',
      contentHash: 'abcdef1234567890',
      contentLength: 42,
      fetchStatus: 200
    })
    const text = triples.join('\n')
    expect(text).toMatch('dim/summary')
    expect(text).toMatch('extractive-v1')
  })

  it('patch deletes stale predicates then inserts', () => {
    const q = buildEnrichmentPatchQuery('http://example.com/g', 'http://purl.org/stuff/dim/bookmark/x', { summary: 'Hi' })
    expect(q).toMatch('DELETE')
    expect(q).toMatch('INSERT DATA')
  })
})

describe('enricher orchestration (stubbed network)', () => {
  const stubFetcher = (body) => ({
    canHandle: () => true,
    fetch: async (url) => ({ url, body, contentType: 'text/html', httpStatus: 200, refused: false })
  })

  function stubStack (body, cachePath, cacheTtlMs) {
    const cache = new CacheWriter({ cachePath })
    const enricher = new Enricher({
      fetchers: [stubFetcher(body)],
      extractors: defaultExtractors(),
      summarisers: defaultSummarisers('extractive'),
      writers: [cache],
      cache,
      ...(cacheTtlMs === undefined ? {} : { cacheTtlMs })
    })
    return enricher
  }

  it('enriches, then reports fresh on repeat, unchanged when stale', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dim-enrich-'))
    const cachePath = path.join(dir, 'enrichment.json')
    const enricher = stubStack('<html><head><title>T</title></head><body><p>Alpha beta gamma delta. Epsilon zeta eta theta. Iota kappa lambda mu.</p></body></html>', cachePath)
    const bookmark = { iri: 'http://purl.org/stuff/dim/bookmark/x', graph: 'http://example.com/g', url: 'https://example.com/x', bookmarkTypes: [] }
    const first = await enricher.run(bookmark)
    expect(first.status).toBe('enriched')
    expect(first.enrichment.summary.length).toBeGreaterThan(0)
    const second = await enricher.run(bookmark)
    expect(second.status).toBe('fresh')
    const stale = stubStack('<html><head><title>T</title></head><body><p>Alpha beta gamma delta. Epsilon zeta eta theta. Iota kappa lambda mu.</p></body></html>', cachePath, 0)
    const third = await stale.run(bookmark)
    expect(third.status).toBe('unchanged')
  })

  it('records refusals without a summary', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'dim-enrich-'))
    const cache = new CacheWriter({ cachePath: path.join(dir, 'enrichment.json') })
    const enricher = new Enricher({
      fetchers: [{ canHandle: () => true, fetch: async (url) => ({ url, body: null, contentType: null, httpStatus: 404, refused: true }) }],
      extractors: defaultExtractors(),
      summarisers: defaultSummarisers('extractive'),
      writers: [cache],
      cache
    })
    const result = await enricher.run({ iri: 'http://purl.org/stuff/dim/bookmark/y', graph: 'http://example.com/g', url: 'https://example.com/missing' })
    expect(result.status).toBe('refused')
    expect(result.enrichment.fetchStatus).toBe(404)
  })
})

describe('summary flows into serialiser + embeddings', () => {
  it('normalise → serialise → composeText carry the summary', () => {
    const b = normaliseBookmark({ url: 'https://example.com/x', linkText: 'X', summary: 'A short summary.', summaryModel: 'extractive-v1' })
    expect(b.summary).toBe('A short summary.')
    const triples = serialiseBookmark(b, 'http://purl.org/stuff/dim/bookmark/x-12345678')
    expect(triples.join('\n')).toMatch('dim/summary')
    expect(composeText(b)).toMatch('A short summary.')
  })
})
