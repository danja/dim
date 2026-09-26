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
| `node bin/enrich.js --limit 50` | Second-pass enrichment (docs/enricher.md): GET targets, summarise, patch `dim:summary*` in place. `--only-new` skips summarised, `--force` ignores cache, `--summariser extractive` runs offline, `--reembed` re-embeds patched rows. |
| `bin/pipeline.sh [--limit N]` | The whole run in one go: retrieve → ingest → enrich (+re-embed) → index → validate. Re-runs resume via caches. `--live` probes URLs at ingest, `--summariser ollama` for LLM summaries, `--no-reembed` / `--skip-validate` to trim stages. |
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

Full runbook: `docs/deployment.md`. The method (images, volumes,
loopback-only ports, memory sizing) is `~/github/plugin-universe`.

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
| `GET /` | Redirects to the default facet (`app.defaultFacet` in `config/config.json`), keeping the query string. |
| `GET /gnamgnam/?q=…&bookmarkType=…&domain=…` | Bookmark search page (HTML). |
| `GET /gnamgnam/search?q=…&bookmarkType=…&domain=…&limit=` | Hybrid results (JSON) with per-signal scores. Each result carries a `data` URL. |
| `GET /gnamgnam/facets` | `bookmarkType` + `domain` values and counts. |
| `GET /gnamgnam/bookmarks?limit=` | Browse. |
| `GET /gnamgnam/bookmark/<slug>[.ttl\|.json]` | One bookmark (content-negotiated). `.ttl` serves the saved triples from the store; search results link it as `data`. |
| `GET /<facet>/` | Other facets (`trestle`, `farelo`, `wiki`, `news`, `blog`, `squirt`): placeholder pages until their phase lands. |
| `GET /ns/<name>.ttl` | Vocabularies (`dim`, `shapes`). |
| `GET /static/…` | Shared UI kit (CSS, JS). |
| `GET /health` | Per-facet status (`facets.gnamgnam` has bookmark/vector counts), embedding model. |

Old URLs `/search`, `/facets`, `/bookmarks`, `/bookmark/<slug>` redirect (301) to `/gnamgnam/…`.

## SPARQL queries (`sparql/queries/`, loaded by name via `QueryService`)

- `graph/register`, `graph/deregister`, `graph/list`, `graph/is-registered`, `graph/cc0-dump-graphs` — provenance + licence registry; the CC0 dump is one query.
- `bookmark/text-view` — one row per bookmark (backs search + embeddings).
- `bookmark/count`, `bookmark/facets`, `bookmark/filter`, `bookmark/bookmark-types`, `bookmark/by-iri`.

## Data & state

- `data/workflowy.md` — source links (committed).
- `data/cache/retrieval.json` — probe cache, 7-day TTL (gitignored).
- `data/cache/enrichment.json` + `data/cache/enrichment/*.txt` — enrichment cache + raw extracted text, 30-day TTL (gitignored).
- `data/dim.index` + `.json` — FAISS vectors + IRI sidecar (gitignored; rebuild with `--only-new`).
