import { ENRICH_CONFIG } from '../../../config/preferences.js'
import { HttpFetcher, GithubApiFetcher, ArxivFetcher, WikipediaFetcher } from './Fetchers.js'
import { HtmlExtractor, PlainTextExtractor, GithubExtractor, PdfExtractor, FallbackExtractor } from './Extractors.js'
import { OllamaSummariser, RemoteSummariser, RotatingSummariser, MechanicalSummariser, ExtractiveSummariser } from './Summarisers.js'
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
 *   remote     — OpenAI-compatible API: several providers in rotation when
 *                LLM_PROVIDERS is set (MISTRAL_API_KEY, GROQ_API_KEY, …),
 *                else one (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL); then the
 *                offline chain
 *   extractive — offline only: mechanical (keywords + markdown, no network)
 *                then extractive sentences
 * By default an LLM is optional: when it fails, the offline chain answers.
 * llmOnly drops the offline chain, so an LLM failure leaves the bookmark
 * unsummarised (and uncached) for a later run instead.
 */
export function defaultSummarisers (preference = ENRICH_CONFIG.summariser, { ollamaBaseUrl, env = process.env, llmOnly = false } = {}) {
  const chain = [new MechanicalSummariser(), new ExtractiveSummariser()]
  if (preference === 'extractive') {
    if (llmOnly) throw new Error('--llm-only needs an LLM summariser (ollama or remote)')
    return chain
  }
  const llm = preference === 'remote'
    ? (env.LLM_PROVIDERS ? RotatingSummariser.fromEnv(env) : RemoteSummariser.fromEnv(env))
    : new OllamaSummariser({ baseUrl: ollamaBaseUrl ?? env.OLLAMA_URL ?? 'http://localhost:11434' })
  return llmOnly ? [llm] : [llm, ...chain]
}

export function defaultCache ({ cachePath } = {}) {
  return new CacheWriter(cachePath ? { cachePath } : {})
}

export function createEnricher (client, { summariser = ENRICH_CONFIG.summariser, cachePath, ollamaBaseUrl, llmOnly = false, observers = [] } = {}) {
  const cache = defaultCache({ cachePath })
  return new Enricher({
    fetchers: defaultFetchers(),
    extractors: defaultExtractors(),
    summarisers: defaultSummarisers(summariser, { ollamaBaseUrl, llmOnly }),
    writers: [new SparqlPatchWriter(client), cache],
    observers,
    cache
  })
}

export default createEnricher
