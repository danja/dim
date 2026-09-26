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

All facets in the plan are built (docs/plan-detail.md): GnamGnam
(bookmarks, hybrid search, enrichment), Trestle (outliner), Farelo (tasks,
Getting Things Diced, "What next?"), Wiki, News, Blog and Squirt (phone view,
installable). Everything is in one SPARQL store, SHACL-validated, one named
graph per facet, cross-linked. Runs on localhost; see
[`docs/deployment.md`](docs/deployment.md) for Docker, backups and reaching
it from a phone, and [`docs/security.md`](docs/security.md) before doing so.

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

Command references: bookmarks [`docs/commands-gnamgnam.md`](docs/commands-gnamgnam.md), outlines [`docs/commands-trestle.md`](docs/commands-trestle.md), tasks [`docs/commands-farelo.md`](docs/commands-farelo.md), wiki [`docs/commands-wiki.md`](docs/commands-wiki.md), news [`docs/commands-news.md`](docs/commands-news.md), blog [`docs/commands-blog.md`](docs/commands-blog.md), phone [`docs/commands-squirt.md`](docs/commands-squirt.md).

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
| `GET /health` | per-facet status (bookmark and index counts for GnamGnam) |
| `GET /trestle/` | outlines (Trestle): the Workflowy outline, editable |
| `GET /farelo/` | tasks (Farelo): Kanban board; `/farelo/next` suggests what to do next (with reasons), `/farelo/dice` rolls for it |
| `GET /wiki/` | wiki pages: `[[Title]]` links, history and diffs |
| `GET /news/` | feed reader: RSS/Atom/JSON Feed; items → bookmarks or tasks |
| `GET /blog/` | blog: posts from wiki pages / outline items, Atom feed, static export |
| `GET /squirt/` | phone front page: search, quick capture, recent activity; installable app with share target |
| `GET /find?q=` | search every facet |
| `GET /tags/<tag>` | everything with a tag, across facets |
| `GET /r/<type>/<slug>` | the page of any DIM resource |
| `POST /links`, `POST /gnamgnam/bookmark/<slug>/annotations` | links, tags and notes — needs `DIM_WRITE_TOKEN` (see `docs/tools.md`) |

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
    `GraphWriter` (batched grouped writes), `ShapeValidator` (SHACL),
    `Repository` (validated writes into facet graphs), `ChangeLog`
  - `rdf/` — `NamespaceManager` (single prefix registry), `URIMinter`
    (content-hash IRIs; one URL = one bookmark), `TurtleReader`
  - `vectors/` — `VectorIndex` (persisted FAISS), `VectorOperations`
  - `embeddings/` — `EmbeddingService`
  - `search/` — `SearchService` (hybrid retrieval, driven by a per-facet
    adapter), `LexicalIndex`
  - `harvest/` — `Harvester` (interface), `HttpSource`
  - `http/` — `Router`, response helpers, content negotiation, static files,
    `auth` (write token, sessions, CSRF), `body`, `write` (write routes),
    `commonRoutes` (health, find, login, `/r`, links)
  - `facets/` — `FacetRegistry` (the facet contract), `stubFacet`
  - `links/` — `LinkStore` (links between any resources), `mentions`
    (`[[references]]` and pasted URLs → IRIs)
  - `ui/` — page shell with the tab row (`layout.js`), links panel, safe
    Markdown, login/find pages; `public/` CSS + JS (link picker)
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
  - `Annotations.js` — the owner's tags and notes on bookmarks
  - `deadlinks/` — Wayback Machine lookups
  - `api/` — routes (under `/gnamgnam`), search page, bookmark Turtle
  - `index.js` — the facet object
- `src/trestle/` — the outliner facet: `OutlineStore` (outlines in memory,
  written through), `tree.js` (pure moves), `importOutline.js`, `api/`
- `src/farelo/` — the task facet: `TaskStore`, `tasks.js` (states, rules),
  `dice.js` (Getting Things Diced), `RollLog`, `fromOutline.js`, `api/`
- `src/wiki/` — the wiki facet: `WikiStore` (pages + revisions),
  `mentionSync.js`, `importPages.js` (foowiki / Markdown files), `api/`
- `src/news/` — the feed reader: `NewsStore`, `Poller` (conditional GET,
  per-host pacing, back-off), `formats/` (feeds, OPML, discovery), `api/`
- `src/blog/` — the blog: `PostStore`, `render.js` (post HTML, Atom),
  `staticSite.js` (export), `sources.js` (drafts from wiki/outline), `api/`
- `src/advisor/` — "What next?": `score.js` (pure scoring, reasons, learning),
  `Advisor.js`, `AdviceStore.js` (feedback, weights), `explain.js` (optional LLM), `api/`
- `src/squirt/` — phone view: `capture.js` (routes captures), `timeline.js`
  (change log + facet `recent()`), `pwa.js` + `sw.js` (manifest, worker), `api/`
- `src/common/outline/OutlineParser.js` — Markdown bullet outlines
  (Workflowy export), shared by the bookmark harvester and Trestle
- `vocabs/dim.ttl`, `vocabs/shapes.ttl` — ontology + SHACL
- `sparql/queries/` — every query, by name
- `tests/common/`, `tests/gnamgnam/` — offline suite (`npm test`);
  `tests/store/` — live-store suite (`npm run test:store`)

## Licence

Code: see [LICENSE](LICENSE). Catalogue data: CC0-1.0.
