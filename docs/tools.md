# DIM — Tools & Commands

All commands run from the repository root. Scripts are `node bin/*.js`;
service topology (ports, datasets) lives in `docker-compose.yml` and `.env`.

## Indexing & retrieval pipeline

| Command | What it does |
|---|---|
| `node bin/retrieve.js` | First-pass retrieval report over `data/workflowy.md` — parses links, classifies each URL into SKOS types, prints the distribution. Offline, no network. |
| `node bin/retrieve.js --live` | Same, but actually GETs each URL (polite: 1s pacing, honest user-agent, refusals recorded not retried). Results cached 7 days in `data/cache/retrieval.json`. Add `--limit N` for a sample. |
| `node bin/ingest.js` | Full run: probe → validate (SHACL) → DROP/reload `graph:source/workflowy` → rebuild type scheme + vocab graphs → embed → checkpointed FAISS index. |
| `node bin/ingest.js --no-fetch` | Skip live probing; classify from URLs alone. Fast, offline, deterministic. |
| `node bin/ingest.js --skip-embeddings` | Store only, no vectors. |
| `node bin/ingest.js --skip-validation` | Skip the pre-write SHACL check (faster re-runs; default is to validate). |
| `node bin/ingest.js --only-new` | Embed only bookmarks missing from the index (reads store, diffs IRIs). Converges to a full index across runs. |
| `node bin/ingest.js --limit N` | Embed at most N bookmarks. For bounded runs while embedding is slow. |
| `node bin/validate.js` | SHACL-validate every registered graph, one report per graph. `--graph <iri>` for one graph, `--verbose` for offending triples. |
| `node bin/search.js "query"` | Hybrid search from the CLI. `--bookmarkType <slug>`, `--domain <host>`, `--facets` for facet counts. |
| `node bin/serve.js` | API + search UI (default `:4110`, override with `PORT`). Loads documents + index once at startup. |

Typical flows:

```sh
node bin/retrieve.js --limit 20          # sanity-check the parser
node bin/ingest.js --no-fetch --skip-embeddings   # offline store build
node bin/ingest.js --only-new --limit 200         # grow the index in chunks
node bin/validate.js                     # confirm the store conforms
node bin/search.js "ESP32 drum machine"  # query it
```

## Services (Docker Compose)

| Command | What it does |
|---|---|
| `docker compose up -d fuseki` | Start the SPARQL store (`:3031`, dataset `dim`, TDB2). |
| `docker compose up -d` | Store + Ollama + app. App serves `:4110`. |
| `docker compose run --rm app node bin/ingest.js --no-fetch --skip-embeddings` | Ingest inside the app container (same image + volumes as the service). |
| `docker compose down` | Stop everything (volumes kept: `fuseki-data`, `ollama-models`, `app-data`). |
| `npm run store:up` / `npm run store:down` | Shorthand for fuseki up / full down. |

## Tests

| Command | What it does |
|---|---|
| `npm test` | Core suite (no external services): parser, classification, minting, shapes, namespaces. |
| `npm run test:store` | Store suite: needs live Fuseki + Ollama. |
| `npm run test:all` | Everything. |

## HTTP API (`:4110`)

| Endpoint | Returns |
|---|---|
| `GET /?q=…&bookmarkType=…&domain=…` | Search page (HTML). |
| `GET /search?q=…&bookmarkType=…&domain=…&limit=` | Hybrid results (JSON) with per-signal scores. |
| `GET /facets` | `bookmarkType` + `domain` values and counts. |
| `GET /bookmarks?limit=` | Browse. |
| `GET /bookmark/<slug>[.ttl\|.json]` | One bookmark (content-negotiated). |
| `GET /ns/<name>.ttl` | Vocabularies (`dim`, `shapes`). |
| `GET /health` | Bookmark/vector counts, embedding model. |

## SPARQL queries (`sparql/queries/`, loaded by name via `QueryService`)

- `graph/register`, `graph/deregister`, `graph/list`, `graph/is-registered`, `graph/cc0-dump-graphs` — provenance + licence registry; the CC0 dump is one query.
- `bookmark/text-view` — one row per bookmark (backs search + embeddings).
- `bookmark/count`, `bookmark/facets`, `bookmark/filter`, `bookmark/bookmark-types`, `bookmark/by-iri`.

## Data & state

- `data/workflowy.md` — source links (committed).
- `data/cache/retrieval.json` — probe cache, 7-day TTL (gitignored).
- `data/dim.index` + `.json` — FAISS vectors + IRI sidecar (gitignored; rebuild with `--only-new`).
