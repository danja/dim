# DIM — Second-Pass Enricher

Augment bookmarks by GETting target URLs and turning the result into a
short summary text, stored in SPARQL and fed to the lexical + vector index.

First-pass stays as-is (`BookmarkHarvester.probe()` in
`src/gnamgnam/harvest/BookmarkHarvester.js` → title + meta description only).
The enricher is a separate, resumable second pass: fetch → extract →
summarise → write. Every stage is a pluggable interface so new sites,
formats, and models are added without touching the orchestrator.

Non-goals: full-page archiving, crawling beyond the bookmark URL, storing
raw page text in SPARQL.

## Pipeline

```text
SPARQL text-view rows ─▶ Enricher ─▶ SPARQL UPDATE patch + re-embed queue
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
    Fetcher ─▶ Extractor ─▶ Summariser ─▶ Writer
    (one per     (one per     (one          (patch store
     source)      format)      model)        + cache)
```

`Enricher.run(bookmark)` (new `src/gnamgnam/enrich/Enricher.js`):

1. Load cached enrichment for `bookmark.url`; skip if `contentHash`
   unchanged and `summarisedAt` fresh (30d default).
2. `Fetcher.fetch(url, ctx)` → `{ body, contentType, httpStatus, headers }`.
3. `Extractor.extract(fetched, ctx)` → `{ text, title?, description? }`
   (capped, boilerplate-stripped; raw text cached to disk, never in RDF).
4. `Summariser.summarise(text, ctx)` → `{ summary, model }`
   (≤1000 chars, 2–3 sentences: what it is + why useful).
5. `Writer.write({ bookmarkIri, summary, provenance })` → SPARQL
   `DELETE/INSERT` per IRI + queue IRI for re-embed.

Each stage throws a typed error (`FetchError`, `ExtractError`,
`SummariseError`, `EnrichError`); a stage failure records
`dim:fetchStatus` / `dim:enrichError` and moves on — one bad URL never
aborts a 5k run.

## Plugin interfaces

All plugins are ESM classes, constructed with `{ config }`, one method
each. Registration is explicit in `src/gnamgnam/enrich/registry.js` (ordered
arrays, first `canHandle()` win) — no magic autoload.

```js
// Fetcher — polite retrieval of one URL
class Fetcher {
  canHandle ({ url, bookmarkType, contentType }) { return true }
  async fetch (url, { signal, cache }) { /* → { body, contentType, httpStatus, headers, fromCache } */ }
}

// Extractor — bytes → clean text
class Extractor {
  canHandle ({ contentType, bookmarkType, url }) { return false }
  async extract (fetched, ctx) { /* → { text, title, description } | null */ }
}

// Summariser — text → rich summary (abstract + keywords + markdown)
class Summariser {
  get id () { return 'ollama/qwen2.5:3b-v1' } // recorded as dim:summaryModel
  async summarise (text, { url, linkText, title, bookmarkType }) {
    /* → { summary, keywords, markdown, model } | null */
  }
}

// Writer — enrichment → durable state
class Writer {
  async write (enrichment) {} // → { patched: boolean, reembed: boolean }
}
```

### Built-in plugins

| Stage | Plugin | Handles | Notes |
|---|---|---|---|
| Fetch | `HttpFetcher` | default `http(s)` | Reuses `HARVEST_CONFIG` pacing/UA/timeout; `ETag`/`Last-Modified`, 1–2MB cap, redirect follow. Extends current `probe()` cache. |
| Fetch | `GithubApiFetcher` | `github.com/<owner>/<repo>` | `api.github.com/repos/` → readme/topics/language. Best-effort, falls back to `HttpFetcher`. |
| Fetch | `ArxivFetcher` | `arxiv.org` | arXiv API → abstract/authors. Skips HTML scrape. |
| Fetch | `WikipediaFetcher` | `*.wikipedia.org` | REST summary API → extract. |
| Extract | `HtmlExtractor` | `text/html` | `readability` + `cheerio` fallback; strips nav/ads; `cleanText` ~20k cap. |
| Extract | `GithubExtractor` | `github-repo` | readme markdown → plain text. |
| Extract | `PdfExtractor` | `application/pdf` | First N pages via `pdfjs`; stub initially (return `null` → fallback). |
| Extract | `FallbackExtractor` | any | Title + meta description only; guarantees a result even when extraction fails. |
| Summarise | `OllamaSummariser` | LLM available | Local LLM (`http://ollama:11434`) with a `SUMMARY:`/`KEY TERMS:` reply shape; keywords backfilled mechanically when absent; markdown always composed locally. Null on any failure so the chain falls through. |
| Summarise | `MechanicalSummariser` | always (offline) | Lead sentences + frequency key terms (`extractKeywords` over lexical-index tokens, stopwords dropped) + locally composed markdown. No network ever — the guaranteed path. |
| Summarise | `ExtractiveSummariser` | final safety net | First 2–3 sentences only. Never calls network. |
| Write | `SparqlPatchWriter` | always | Per-IRI `DELETE/INSERT` (see below); updates `dim:summary*`. |
| Write | `CacheWriter` | always | Disk cache entry with `contentHash`, `summary`, `model`, timestamps. |

Adding a site later = one new `Fetcher`/`Extractor` file + one line in
`registry.js` + one test. No orchestrator change.

### Selection

```js
// src/gnamgnam/enrich/registry.js
export const fetchers   = [new GithubApiFetcher(), new ArxivFetcher(), new WikipediaFetcher(), new HttpFetcher()]
export const extractors = [new GithubExtractor(), new HtmlExtractor(), new PdfExtractor(), new FallbackExtractor()]
export const summarisers = [new OllamaSummariser(), new ExtractiveSummariser()] // tried in order
export const writers    = [new SparqlPatchWriter(client), new CacheWriter(cachePath)]
```

`canHandle()` order is most-specific first, default last. Type hints
come from `classifyUrl()` (`src/gnamgnam/harvest/BookmarkNormaliser.js`) +
live `contentType`.

## Data model

Extend `vocabs/dim.ttl` (mirrors existing `dim:tag`, `dim:domain` style):

```turtle
dim:summary a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:string ;
    rdfs:comment "Second-pass summary of the target, at most 1000 chars." .
dim:keyword a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:string ;
    rdfs:comment "Second-pass key term for the target, lower-cased. Repeatable; from the LLM reply or frequency extraction." .
dim:summaryMarkdown a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:string ;
    rdfs:comment "Second-pass summary as a short markdown document, at most 4000 chars. Composed locally in a fixed shape." .
dim:summaryModel a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:string .
dim:summarisedAt a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:dateTime .
dim:contentHash a owl:DatatypeProperty ; rdfs:domain dim:Bookmark ; rdfs:range xsd:string .
```

Raw extracted text stays in `data/cache/enrichment/<hash>.txt`
(gitignored), never in triples. `dim:summary` feeds:

* `sparql/queries/bookmark/text-view.sparql` — add
  `OPTIONAL { ?bookmark dim:summary ?summary }` (+ model/date for debugging).
* `EmbeddingService.textView()/composeText()`
  (`src/gnamgnam/BookmarkText.js`) — append summary after
  description, before tags; `textHash()` then auto-invalidates stale vectors.
* `SearchService.loadDocuments()` (`src/common/search/SearchService.js` + `src/gnamgnam/BookmarkSearch.js`) —
  map `summary` into the lexical `body` field (`LexicalIndex.js:43-55`).

Patch shape (via `SPARQLHelper.iri()/literal()` + `QueryService`, same
conventions as `IngestPipeline`):

```sparql
DELETE { GRAPH <g> { <iri> dim:summary ?s ; dim:summaryModel ?m ; dim:summarisedAt ?d ; dim:contentHash ?h } }
INSERT { GRAPH <g> { <iri> dim:summary "..." ; dim:summaryModel "..." ; dim:summarisedAt "..."^^xsd:dateTime ; dim:contentHash "..." } }
WHERE  { ... }
```

Alternative later: separate `enrichment/summary-v1` graph joined at
query time. Start with in-place patch — simpler for `text-view` and index.

## Config (`config/config.json` + `config/preferences.js`)

```js
export const ENRICH_CONFIG = {
  summaryMaxChars: 1000,
  extractMaxChars: 20000,
  fetchMaxBytes: 2 * 1024 * 1024,
  cacheTtlMs: 30 * 24 * 3600 * 1000,
  summariser: 'ollama', // | 'extractive' (offline/deterministic)
  model: 'qwen2.5:3b',  // small: ollama mem_limit is 1600m
  promptVersion: 'summary-v1',
  checkpointEvery: 100
}
```

Follows `Config` conventions: no inline fallbacks, `${VAR}` interpolation.

## CLI (`bin/enrich.js`, mirrors `bin/ingest.js` flags)

```sh
node bin/enrich.js --limit 50              # sample across types first
node bin/enrich.js --only-new              # skip fresh contentHash entries
node bin/enrich.js --summariser extractive # offline, no LLM
node bin/enrich.js --reembed --limit 200   # patch store then re-embed queue
```

Re-embed reuses the `bin/ingest.js:99-133` pattern: diff `textHash`
against `VectorIndex.positionByIri`, `index.add()` replacements,
`compact()` + `save()` every 100.

## Politeness & safety

* Per-host pacing (`HARVEST_CONFIG.requestIntervalMs`), honest UA +
  `/about/crawler`, `robots.txt` respected by `HttpFetcher`.
* Existing `REFUSALS` (401/403/404/410/429/451) recorded as
  `dim:fetchStatus`, not retried within TTL.
* Summaries marked derived (`prov:wasDerivedFrom` target URL +
  `dim:summaryModel`); CC0-compatible; no paywall bypass.

## Tests (mirror `npm test` / `test:store` split)

* Core (no network): each `Extractor.canHandle()` matrix, `HtmlExtractor`
  boilerplate stripping, `ExtractiveSummariser` truncation, `composeText`
  includes summary, `textHash` changes on summary change, patch query builder.
* Store (live Fuseki): patch one bookmark, `text-view` returns summary,
  re-embed replaces vector.
* Manual gate: `--limit 50` reviewed before full 5k run.

## Catalogue details

Site fetchers also return a `catalogue` object (`src/gnamgnam/Catalogue.js`):
GitHub → `githubLanguage`, `githubStars`, `githubTopic`; arXiv →
`arxivAuthor`, `arxivCategory`. The patch writer owns these predicates and
replaces them on every patch. URL-derivable details (`githubOwner`,
`githubRepo`, `arxivId`, `wikipediaLanguage`, `wikipediaTitle`) are written
at ingest instead, so enrichment never erases them.

## LLM summarisers

`--summariser ollama` (default) uses local Ollama (`OLLAMA_URL`,
`ENRICH_CONFIG.model`). `--summariser remote` uses any OpenAI-compatible
chat-completions API (`src/gnamgnam/enrich/summarise/RemoteSummariser.js`),
configured by `LLM_BASE_URL` (e.g. `https://…/v1`), `LLM_API_KEY` and
`LLM_MODEL`; `dim:summaryModel` records it as
`remote/<host>/<model>-<promptVersion>`. It paces requests
(`remoteRequestIntervalMs`); retries transient failures (429, 500, 502,
503 "high demand", 504, network errors) up to `remoteMaxRetries` times with
exponential backoff (`remoteRetryBaseMs` doubling, capped at
`remoteRetryCapMs`) or the server's `Retry-After`; and stops at the first
401/403. A bookmark that still fails counts once towards the circuit breaker. Page text is sent to the provider.

**Rotation.** With `LLM_PROVIDERS=mistral,groq,openrouter` (and those
providers' keys — peasant's names: `MISTRAL_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `HF_TOKEN`, `NVIDIA_API_KEY`),
`RotatingSummariser` sends each bookmark to the first available provider.
A 429/5xx/network error cools that provider down (Retry-After, or its own
doubling backoff) and the next is asked at once; 401/402/403 drops it for
the run; a bad or empty reply passes the bookmark to the next provider.
When all are cooling it waits for the first back, up to `rotationMaxWaitMs`
per bookmark. Base URLs, default models and reply budgets are in
`summarise/providers.js` (from peasant's measured profiles); override with
`<NAME>_MODEL`, `<NAME>_BASE_URL`, `<NAME>_MAX_TOKENS`. `dim:summaryModel`
names the provider and model that actually answered.

Both share the prompt and reply parsing (`summarise/llm.js`) and a circuit
breaker: after `llmFailureLimit` consecutive failures (timeouts, errors,
empty replies) the LLM is skipped for the rest of the run and the offline
chain answers, instead of every bookmark waiting out a timeout.
`--llm-only` drops the offline chain: an LLM failure leaves the bookmark
unwritten and uncached, and the run stops once the breaker opens — suited
to free tiers with a daily quota (re-run with `--only-new` the next day).

Gemini: `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
`LLM_MODEL=gemini-flash-latest`. Flash "thinks", and its reasoning counts
against the reply budget; a reply cut off at `max_tokens` is reported as
such — raise `LLM_MAX_TOKENS` (e.g. 2048). Input size,
reply budget and timeouts are in `ENRICH_CONFIG` (`llmInputChars`,
`llmMaxTokens`, `ollamaTimeoutMs`, `remoteTimeoutMs`).

## Surviving a re-ingest

`bin/ingest.js` drops and reloads the source graph, which removes enrichment
triples. `bin/enrich.js` passes `hasEnrichment` (store row has a summary or
fetch status); a cache hit on a row without it is written back to the store
and reported as `restored`, with no refetch. Before this, a re-ingest
followed by an enrich run silently lost every summary until the 30-day
cache TTL expired.

## Known limits

- The GitHub API allows 60 unauthenticated requests an hour; beyond that it
  answers 403, which is recorded as a refusal (`blocked` link status). Set
  `GITHUB_TOKEN` before a full run.

- A few pages stall `nomic-embed-text` past the 60s request timeout
  (observed: CJK-heavy text, likely tokenizer blowup). `--reembed`
  logs these per bookmark and continues; they keep their previous
  vector. Re-running later retries them.
- While a stalled request occupies the runner, other embeds queue
  behind it — if many timeouts cluster, stop the run, let Ollama drain,
  and re-run (caches make it cheap).

## Build order
1. `vocabs/dim.ttl` terms + SHACL shape + `text-view.sparql` optional.
2. `src/gnamgnam/enrich/{Enricher,Fetcher,Extractors,Summarisers,Writers,registry}.js` + `ENRICH_CONFIG`.
3. `FallbackExtractor` + `ExtractiveSummariser` + `CacheWriter` (fully offline path works end-to-end).
4. `HttpFetcher` + `HtmlExtractor` + `SparqlPatchWriter` + `bin/enrich.js --limit`.
5. `OllamaSummariser` + site fetchers (GitHub/arXiv/Wikipedia) + re-embed wiring.
6. Sample → review → full run → `docs/plan.md` status update.
