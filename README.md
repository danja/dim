# dim — Danny's Information Manager

A knowledgebase and toolset over a shared core built from a SPARQL store and an
embedding index. Adapted from
[plugin-universe](https://github.com/danja/plugin-universe): the same Fuseki +
FAISS + Ollama shape, applied to bookmarks instead of plugins.

The first dataset is derived from `data/workflowy.md`. A retrieval agent GETs
each link, first-pass determines the target type (github repo, arxiv paper,
wikipedia article, …), stores it as a `dim:Bookmark` with URL + link text, and
catalogues it in a SKOS concept scheme (`dim:bookmark-types`).

## Status

Core port complete: 5,121 bookmarks in the store, SHACL-validated, hybrid
(lexical + vector) search over them, read-only API + search UI.

## Requirements

- Node ≥ 20.11
- A SPARQL 1.1 store (Fuseki; `docker compose up -d fuseki` provides one on :3031)
- Ollama with `nomic-embed-text:v1.5` for embeddings

## Setup

```sh
npm install
cp .env.example .env      # then fill it in — there are no defaults
docker compose up -d fuseki
```

## Use

```sh
node bin/retrieve.js              # first-pass report over workflowy.md (offline)
node bin/retrieve.js --live       # actually GET each URL (cached 7 days in data/cache)
node bin/ingest.js --no-fetch --skip-embeddings   # parse + classify + store, no network
node bin/ingest.js                # full: probe, store, embed
node bin/search.js "modular synth DIY"
node bin/search.js --facets
node bin/validate.js              # SHACL, graph by graph
node bin/deadlinks.js --wayback   # dead links, with Wayback Machine copies
node bin/serve.js                 # search UI + JSON API on :4110
```

| Endpoint | Returns |
|---|---|
| `GET /` | redirects to the default facet (`app.defaultFacet`, GnamGnam) |
| `GET /gnamgnam/` | server-rendered bookmark search page |
| `GET /gnamgnam/search?q=&bookmarkType=&domain=` | hybrid search results as JSON |
| `GET /gnamgnam/facets` | facet values and counts |
| `GET /gnamgnam/bookmarks` | browse |
| `GET /gnamgnam/bookmark/<slug>` | one bookmark — HTML detail page, JSON by `.json`, Turtle by `.ttl` |
| `GET /<facet>/` | Trestle, Farelo, Wiki, News, Blog, Squirt — placeholder pages until built |
| `GET /health` | per-facet status (bookmark and index counts for GnamGnam) |

Every page shares one mobile-first shell with a tab per facet
(`src/common/ui/`). The pre-facet URLs (`/search`, `/facets`, `/bookmarks`,
`/bookmark/<slug>`) redirect permanently to their `/gnamgnam/` equivalents.

## Layout

Shared core in `src/common/`, one directory per facet (see `docs/plan.md`).
GnamGnam (bookmarks) is the first facet.

- `src/server.js` — HTTP server: common routes (`/`, `/health`, `/ns`,
  `/static`) plus each facet's routes
- `src/facets.js` — every facet, in tab order
- `src/common/` — facet-agnostic core (copied from plugin-universe, adapted)
  - `store/` — `SPARQLClient`, `SPARQLHelper`, `QueryService` (file-based
    queries), `GraphRegistry` (named graphs, provenance, licence flags),
    `GraphWriter` (batched grouped writes), `ShapeValidator` (SHACL)
  - `rdf/` — `NamespaceManager` (single prefix registry), `URIMinter`
    (content-hash IRIs; one URL = one bookmark), `TurtleReader`
  - `vectors/` — `VectorIndex` (persisted FAISS), `VectorOperations`
  - `embeddings/` — `EmbeddingService`
  - `search/` — `SearchService` (hybrid retrieval, driven by a per-facet
    adapter), `LexicalIndex`
  - `harvest/` — `Harvester` (interface), `HttpSource`
  - `http/` — `Router`, response helpers, content negotiation, static files
  - `facets/` — `FacetRegistry` (the facet contract), `stubFacet`
  - `ui/` — page shell with the tab row (`layout.js`); `public/` CSS + JS
- `src/gnamgnam/` — the bookmark facet
  - `harvest/` — `BookmarkHarvester` (retrieval agent), `WorkflowyParser`,
    `BookmarkNormaliser` (URL-heuristic SKOS typing), `BookmarkSerialiser`,
    `IngestPipeline`
  - `enrich/` — second-pass enricher (`docs/enricher.md`); plugins in
    `fetch/` and `summarise/`
  - `BookmarkText.js` — composed text view for embeddings
  - `BookmarkSearch.js` — search adapter
  - `Catalogue.js` — per-type catalogue details (GitHub, arXiv, Wikipedia)
  - `LinkStatus.js` — ok / dead / blocked / error / unchecked
  - `deadlinks/` — Wayback Machine lookups
  - `api/` — routes (under `/gnamgnam`), search page, bookmark Turtle
  - `index.js` — the facet object
- `vocabs/dim.ttl`, `vocabs/shapes.ttl` — ontology + SHACL
- `sparql/queries/` — every query, by name
- `tests/common/`, `tests/gnamgnam/` — offline suite (`npm test`);
  `tests/store/` — live-store suite (`npm run test:store`)

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0.
