import { ENRICH_CONFIG } from '../../config/preferences.js'
import { HttpFetcher, GithubApiFetcher, ArxivFetcher, WikipediaFetcher } from './Fetchers.js'
import { HtmlExtractor, PlainTextExtractor, GithubExtractor, PdfExtractor, FallbackExtractor } from './Extractors.js'
import { OllamaSummariser, MechanicalSummariser, ExtractiveSummariser } from './Summarisers.js'
import { SparqlPatchWriter, CacheWriter } from './Writers.js'
import { Enricher } from './Enricher.js'

/**
 * Default plugin registries for the enricher (docs/enricher.md).
 *
 * Order is most-specific first, default last. Adding a site later is one
 * new plugin file plus one line here — the orchestrator never changes.
 */

export function defaultFetchers () {
  return [new GithubApiFetcher(), new ArxivFetcher(), new WikipediaFetcher(), new HttpFetcher()]
}

export function defaultExtractors () {
  return [new GithubExtractor(), new HtmlExtractor(), new PlainTextExtractor(), new PdfExtractor(), new FallbackExtractor()]
}

/**
 * @param {'ollama'|'extractive'} preference — extractive is fully offline:
 *   mechanical (keywords + markdown, no network) then extractive sentences.
 *   The LLM is only ever in the ollama chain, and always optional.
 */
export function defaultSummarisers (preference = ENRICH_CONFIG.summariser, { ollamaBaseUrl } = {}) {
  const baseUrl = ollamaBaseUrl ?? process.env.OLLAMA_URL ?? 'http://localhost:11434'
  const chain = [new MechanicalSummariser(), new ExtractiveSummariser()]
  return preference === 'extractive'
    ? chain
    : [new OllamaSummariser({ baseUrl }), ...chain]
}

export function defaultCache ({ cachePath } = {}) {
  return new CacheWriter(cachePath ? { cachePath } : {})
}

export function createEnricher (client, { summariser = ENRICH_CONFIG.summariser, cachePath, ollamaBaseUrl } = {}) {
  const cache = defaultCache({ cachePath })
  return new Enricher({
    fetchers: defaultFetchers(),
    extractors: defaultExtractors(),
    summarisers: defaultSummarisers(summariser, { ollamaBaseUrl }),
    writers: [new SparqlPatchWriter(client), cache],
    cache
  })
}

export default createEnricher
