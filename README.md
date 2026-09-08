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
node bin/serve.js                 # search UI + JSON API on :4110
```

| Endpoint | Returns |
|---|---|
| `GET /` | server-rendered search page |
| `GET /search?q=&bookmarkType=&domain=` | hybrid search results as JSON |
| `GET /facets` | facet values and counts |
| `GET /bookmarks` | browse |
| `GET /bookmark/<slug>` | one bookmark — HTML/JSON, or Turtle by `Accept`/`.ttl` |
| `GET /health` | corpus and index size |

## Layout (copied from plugin-universe, adapted)

- `src/store/` — `SPARQLClient`, `SPARQLHelper`, `QueryService` (file-based
  queries), `GraphRegistry` (named graphs, provenance, licence flags),
  `ShapeValidator` (SHACL)
- `src/rdf/` — `NamespaceManager` (single prefix registry), `URIMinter`
  (content-hash IRIs; one URL = one bookmark)
- `src/vectors/` — `VectorIndex` (persisted FAISS), `VectorOperations`
- `src/embeddings/` — `EmbeddingService`, bookmark text view
- `src/search/` — `SearchService` (hybrid retrieval), `LexicalIndex`
- `src/harvest/` — `Harvester` (interface), `BookmarkHarvester` (retrieval
  agent), `WorkflowyParser`, `BookmarkNormaliser` (URL-heuristic SKOS typing),
  `BookmarkSerialiser`, `IngestPipeline`, `HttpSource`, `TurtleReader`
- `src/api/server.js` — read-only JSON + HTML
- `vocabs/dim.ttl`, `vocabs/shapes.ttl` — ontology + SHACL
- `sparql/queries/` — every query, by name

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0.
