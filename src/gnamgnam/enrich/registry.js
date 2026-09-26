import { ENRICH_CONFIG } from '../../../config/preferences.js'
import { HttpFetcher, GithubApiFetcher, ArxivFetcher, WikipediaFetcher } from './Fetchers.js'
import { HtmlExtractor, PlainTextExtractor, GithubExtractor, PdfExtractor, FallbackExtractor } from './Extractors.js'
import { OllamaSummariser, RemoteSummariser, MechanicalSummariser, ExtractiveSummariser } from './Summarisers.js'
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

export const SUMMARISER_CHOICES = Object.freeze(['ollama', 'remote', 'extractive'])

/**
 * @param {'ollama'|'remote'|'extractive'} preference
 *   ollama     — local Ollama (OLLAMA_URL), then the offline chain
 *   remote     — OpenAI-compatible API (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL),
 *                then the offline chain
 *   extractive — offline only: mechanical (keywords + markdown, no network)
 *                then extractive sentences
 * An LLM is always optional: when it fails, the offline chain answers.
 */
export function defaultSummarisers (preference = ENRICH_CONFIG.summariser, { ollamaBaseUrl, env = process.env } = {}) {
  const chain = [new MechanicalSummariser(), new ExtractiveSummariser()]
  if (preference === 'extractive') return chain
  if (preference === 'remote') return [RemoteSummariser.fromEnv(env), ...chain]
  const baseUrl = ollamaBaseUrl ?? env.OLLAMA_URL ?? 'http://localhost:11434'
  return [new OllamaSummariser({ baseUrl }), ...chain]
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
