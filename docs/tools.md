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
| `node bin/enrich.js --limit 50` | Second-pass enrichment (docs/enricher.md): GET targets, summarise, patch `dim:summary*` and API catalogue details (GitHub language/stars/topics, arXiv authors/categories) in place. `--only-new` skips summarised, `--force` ignores cache, `--summariser extractive` runs offline, `--summariser remote` uses OpenAI-compatible APIs — several free tiers in rotation with `LLM_PROVIDERS=mistral,groq,…` plus their keys (`MISTRAL_API_KEY`, `GROQ_API_KEY`, …), or one endpoint (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, optional `LLM_MAX_TOKENS`), `--llm-only` writes LLM summaries or nothing and stops when the LLM gives up (quota), `--reembed` re-embeds patched rows. After a re-ingest, cached results are written back (`restored`) without refetching. Set `GITHUB_TOKEN` for more than 60 GitHub API calls an hour. |
| `node bin/trestle-import.js` | Import `data/workflowy.md` as a Trestle outline (`--replace` to redo it, `--file/--slug/--title` for another). Links items to their bookmarks. See `docs/commands-trestle.md`. |
| `node bin/farelo-import.js` | Seed Farelo tasks from the outline's TODO sections (`--dry-run`, `--status todo`, `--outline <slug>`). See `docs/commands-farelo.md`. |
| `node bin/wiki-import.js` | Import wiki pages from a foowiki Turtle dump (`--turtle <file>`) or a folder of Markdown files (`--dir <folder>`); `--dry-run` to preview. See `docs/commands-wiki.md`. |
| `node bin/news.js …` | Feed reader: `add <url>`, `import <opml or list>`, `export`, `list`, `poll [--all]`, `prune`, `remove <slug>`. See `docs/commands-news.md`. |
| `node bin/blog-export.js` | Published blog posts → a static site with Atom feed (`--out`, `--base-url`, `--title`, `--author`). See `docs/commands-blog.md`. |
| `node bin/backup.js` / `node bin/restore.js` | Back up the store (all graphs, TriG) + vector index (+ caches with `--with-cache`); restore one (`--list`, `<dir> --yes`, `--store-only`). See `docs/deployment.md`. |
| `node bin/deadlinks.js` | Link-status report (`--status dead\|blocked\|error\|ok\|unchecked`, default `dead`; `--json`, `--limit N`). `--wayback` looks up Wayback Machine snapshots for the listed bookmarks (1 req/s, cached in `data/cache/wayback.json`) and writes `schema:archivedAt`; re-run after a re-ingest to restore them from the cache. |
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
| `GET /gnamgnam/?q=…&bookmarkType=…&domain=…&linkStatus=…` | Bookmark search page (HTML). `linkStatus` is `ok`, `dead`, `blocked`, `error` or `unchecked`, derived from the last HTTP status seen. |
| `GET /gnamgnam/search?q=…&bookmarkType=…&domain=…&limit=` | Hybrid results (JSON) with per-signal scores. Each result carries a `data` URL. |
| `GET /gnamgnam/facets` | `bookmarkType`, `domain` and `linkStatus` values and counts. |
| `GET /gnamgnam/bookmarks?limit=` | Browse. |
| `GET /gnamgnam/bookmark/<slug>[.ttl\|.json]` | One bookmark (content-negotiated): an HTML detail page (summary, link status, archived copy, catalogue details, outline context) by default, JSON by `.json`/`Accept`, the saved triples by `.ttl`/`Accept`. |
| `GET /trestle/…` | Trestle outlines — see `docs/commands-trestle.md` for pages, exports and write routes. |
| `GET /farelo/…` | Farelo board, tasks and dice — see `docs/commands-farelo.md`. |
| `GET /wiki/…` | Wiki pages, history, diffs — see `docs/commands-wiki.md`. |
| `GET /news/…` | News river, items, feeds, OPML — see `docs/commands-news.md`. |
| `GET /blog/…` | Blog posts, tags, Atom feed — see `docs/commands-blog.md`. |
| `GET /squirt/…` | Phone front page, capture, share target, manifest, service worker — see `docs/commands-squirt.md`. |
| `GET /ns/<name>.ttl` | Vocabularies (`dim`, `shapes`). |
| `GET /static/…` | Shared UI kit (CSS, JS). |
| `GET /health` | Per-facet status (`facets.gnamgnam` has bookmark/vector counts), whether writes are enabled, embedding model. |
| `GET /find?q=…` / `GET /find.json?q=…&limit=` | Search every facet; results grouped by facet. |
| `GET /r/<type>/<slug>`, `GET /r?iri=…` | Redirect to the page of any DIM resource. |
| `GET /login`, `POST /login`, `POST /logout` | Browser session for writing (`token` = `DIM_WRITE_TOKEN`). |
| `GET /links?iri=…` | Links touching a resource, both directions, with labels and pages. |
| `POST /links` | Add a link: `from`, `to` (IRI, page URL, bookmarked URL or `[[type/slug]]`), `kind` = `related` \| `resource` \| `partOf`. |
| `POST /links/delete` | Remove a link (same fields). |
| `POST /gnamgnam/bookmark/<slug>/annotations` | Replace the owner's `tags` (comma-separated or array) and `note` (Markdown) on a bookmark. |

**Writes** need `DIM_WRITE_TOKEN` (16+ chars) in `.env`; without it the server is read-only. Scripts send it as `Authorization: Bearer <token>` (or the Basic password) with a JSON body; browsers log in at `/login` and forms carry a CSRF token. Every write is SHACL-checked first (422 with reasons if rejected) and logged in `graph:system/changes`. User data lives in `graph:facet/<facet>` and links in `graph:facet/links`, so an ingest never touches it.

Old URLs `/search`, `/facets`, `/bookmarks`, `/bookmark/<slug>` redirect (301) to `/gnamgnam/…`.

## SPARQL queries (`sparql/queries/`, loaded by name via `QueryService`)

- `graph/register`, `graph/deregister`, `graph/list`, `graph/is-registered`, `graph/cc0-dump-graphs` — provenance + licence registry; the CC0 dump is one query.
- `bookmark/text-view` — one row per bookmark (backs search + embeddings).
- `bookmark/count`, `bookmark/facets`, `bookmark/filter`, `bookmark/bookmark-types`, `bookmark/by-iri`.
- `bookmark/statuses` — HTTP statuses + archived copy per bookmark (backs `bin/deadlinks.js`).

Every named query is parsed by a test (`tests/common/store/queries.test.js`).

## Data & state

- `data/workflowy.md` — source links (committed).
- `data/cache/retrieval.json` — probe cache, 7-day TTL (gitignored).
- `data/cache/enrichment.json` + `data/cache/enrichment/*.txt` — enrichment cache + raw extracted text, 30-day TTL (gitignored).
- `data/cache/wayback.json` — Wayback Machine answers, including "no snapshot" (gitignored).
- `data/dim.index` + `.json` — FAISS vectors + IRI sidecar (gitignored; rebuild with `--only-new`).
