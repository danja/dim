# DIM — Detailed Plan & Work Record

Derived from [`docs/plan.md`](plan.md). That file holds the vision; this
one breaks it into phases with concrete tasks, acceptance criteria and a
running log. **Update it as work lands** — tick boxes, fill in dates and
commit refs, and add a line to the [Work log](#work-log).

Status keys: `[x]` done · `[~]` in progress / partial · `[ ]` not started ·
`[-]` dropped (say why).

---

## Guiding constraints

These apply to every phase; a task isn't done if it breaks one.

| # | Constraint | Source |
|---|---|---|
| C1 | Modern vanilla HTML, CSS, ESM JS. No framework, no bundler unless forced. | plan.md |
| C2 | Data is Turtle/RDF; content is Markdown. | plan.md |
| C3 | One directory per facet under `src/<facet>`; shared code in `src/common`. | plan.md |
| C4 | One named graph (or graph family) per facet; maximal cross-linking between them. | plan.md |
| C5 | Every facet has its own mobile-first page; a tab row across the top links all facets. | plan.md |
| C6 | Maximally modular; large files refactored. Working rule: split any source file over ~200 lines. | plan.md |
| C7 | Node ≥ 20.11 + Vitest. Core tests run offline (`npm test`); store tests need live services (`npm run test:store`). | plan.md, package.json |
| C8 | Runs in Docker on localhost; services published on loopback only. | plan.md, docs/deployment.md |
| C9 | No silent defaults for config — a missing value is an error. | docs/deployment.md |
| C10 | Every triple lives in a registered graph with provenance and licence (`GraphRegistry`). | src/store/GraphRegistry.js |

### Namespace & graph conventions (to be fixed in Phase 1)

- Vocabulary: `dim:` = `http://purl.org/stuff/dim/`; facet-specific terms
  go in `vocabs/<facet>.ttl` with the same base, shapes in
  `vocabs/shapes/<facet>.ttl`.
- Graphs: keep the existing `graph:source/*`, `graph:system/*` kinds, and add a
  `facet` kind: `graph:facet/<facet>` (e.g. `graph:facet/farelo`). The
  shared cross-link graph is `graph:facet/links`.
- Resource IRIs are minted by `src/common/rdf/URIMinter.js`, one path
  segment per facet: `…/dim/bookmark/<slug>`, `…/dim/task/<slug>`,
  `…/dim/note/<slug>`, `…/dim/post/<slug>`, `…/dim/feed/<slug>`,
  `…/dim/item/<slug>`.

---

## Phase overview

| Phase | Name | Depends on | Status |
|---|---|---|---|
| 0 | Starter: core port + first dataset | — | `[~]` mostly done |
| 1 | Restructure into `common` + `gnamgnam` | 0 | `[x]` |
| 2 | Shared shell: facet registry, tabs, mobile-first UI kit | 1 | `[x]` |
| 3 | GnamGnam completion (live probe, enrichment, full index) | 1 (2 for UI) | `[~]` 3a code done; 3b local runs |
| 4 | Write path & cross-linking foundation | 2 | `[x]` |
| 5 | Trestle outliner | 4 | `[x]` (local check pending) |
| 6 | Farelo (Kanban + Getting Things Diced) | 4 | `[x]` (local check pending) |
| 7 | Wiki (from foowiki) | 4 | `[x]` (local check pending) |
| 8 | Newsmonitor (RSS) | 4 | `[x]` (local check pending) |
| 9 | Blog engine | 7 | `[x]` (local check pending) |
| 10 | Squirt — mobile view of everything | 5–9 (incrementally) | `[x]` (phone check needs https) |
| 11 | "What next?" advisor | 6, 3, 4 | `[x]` (local check pending) |
| 12 | Operations: backup, auth, deploy hardening | runs alongside | `[x]` |
| 13 | Cross-facet contact | 3–11 | `[x]` (people later) |

Phases 5–8 are independent of each other once Phase 4 is done and can be
taken in any order; the order above puts the todo graph (Farelo) and the
outliner (Trestle, closest to the Workflowy source) first because they
carry the "ultimate aim".

---

## Phase 0 — Starter (core port + first dataset)

**Goal:** a working SPARQL + embedding core over the Workflowy bookmarks,
in Docker on localhost.

### Tasks

- [x] Identify core features of `~/github/plugin-universe` and port them:
      Fuseki TDB2 store, named graph per source, SHACL validation,
      persisted FAISS index, Ollama embeddings, hybrid lexical+vector
      search, read-only API + UI.
- [x] Docker Compose: `fuseki` (:3031), `ollama` (:11434), `app` (:4110),
      loopback only.
- [x] Parse `data/workflowy.md` → 5,121 `dim:Bookmark`s in
      `graph:source/workflowy` (5,136 unique URLs, 15 non-http rejected), CC0.
- [x] First-pass SKOS typing from URL heuristics: `dim:bookmark-types`,
      14 concepts (webpage 2989, github-repo 991, wikipedia-article 398,
      docs 235, arxiv-paper 170, …).
- [x] Second-pass enricher implemented (`src/enrich/*`, `bin/enrich.js`,
      docs/enricher.md): fetch → extract → summarise → write, pluggable
      stages, cache, `--reembed`.
- [x] `bin/pipeline.sh` one-shot run.
- [x] Docs: `README.md`, `docs/tools.md`, `docs/deployment.md`, `docs/enricher.md`.
- [~] Live GET probing (`bin/retrieve.js --live`) — implemented, **not run
      over the full set**; titles/descriptions still null.
- [~] Full vector index — converging via `ingest --only-new`.

### Acceptance

- `/health` reports 5121 bookmarks. ✔
- `npm test` green. (re-verify at start of Phase 1)
- Remaining `[~]` items move to Phase 3.

---

## Phase 1 — Restructure into `src/common` + `src/gnamgnam`

**Goal:** the current codebase becomes the first facet (GnamGnam) sitting on
a shared core, with no behaviour change.

### 1.1 Decide the split

| Goes to `src/common/` | Goes to `src/gnamgnam/` |
|---|---|
| `Config.js` | `harvest/BookmarkHarvester.js`, `BookmarkNormaliser.js`, `BookmarkSerialiser.js`, `WorkflowyParser.js`, `IngestPipeline.js` (bookmark-specific parts) |
| `store/*` (SPARQLClient, SPARQLHelper, QueryService, GraphRegistry, ShapeValidator) | `enrich/*` (Enricher and plugins are bookmark-driven; move generic fetch/extract helpers to common if another facet needs them — Newsmonitor will) |
| `rdf/*` (NamespaceManager, URIMinter) | bookmark API routes + search page from `api/server.js` |
| `embeddings/EmbeddingService.js`, `vectors/*` | `sparql/queries/bookmark/*` → `src/gnamgnam/queries/` or keep `sparql/` with per-facet subdirs |
| `search/LexicalIndex.js`, `SearchService.js` (made document-type agnostic) | |
| `harvest/Harvester.js`, `HttpSource.js`, `TurtleReader.js` (generic) | |
| generic parts of `api/server.js` (negotiation, send helpers, `/health`, `/ns`) | |

### 1.2 Tasks

- [x] Run `npm test` and record the baseline — 6 files, 43 tests, all pass.
- [x] Create `src/common/` and `src/gnamgnam/`; `git mv` files per 1.1 so
      history follows. `TurtleReader` went to `common/rdf/` (ShapeValidator
      needs it); `src/api/server.js` became `src/server.js`.
- [x] Update all imports in `src/`, `bin/`, `tests/`, `config/`.
      `Config` and `QueryService` project-root paths adjusted for the new depth.
- [x] Make `SearchService` generic: it now requires an `adapter`
      (`{ id, queries: { textView, filter, facets, count }, subject,
      facetNames, toDocument(row, provenance), filterConditions(facets) }`).
      GnamGnam supplies `src/gnamgnam/BookmarkSearch.js`. `LexicalIndex`
      was already field-generic and is unchanged. Bookmark text composition
      (`textView`, `composeText`) moved from `EmbeddingService` to
      `src/gnamgnam/BookmarkText.js`; `EmbeddingService.embedBookmark/embedBatch`
      (unused) replaced by `embedText(text)`.
- [x] Split `src/api/server.js` (243 lines) into
      `src/common/http/{Router,negotiate,respond}.js`, `src/server.js`
      (common routes `/health`, `/ns`) and
      `src/gnamgnam/api/{routes,searchPage,bookmarkData}.js`. URLs unchanged.
      `Router` pulled forward from Phase 2.
- [x] Refactor other files over ~200 lines (C6):
  - `enrich/Summarisers.js` (248) → `enrich/summarise/{Summariser,text,ExtractiveSummarisers,OllamaSummariser}.js`
  - `enrich/Fetchers.js` (216) → `enrich/fetch/{Fetcher,HttpFetcher,ApiFetchers}.js`
  - The old files remain as re-export barrels so importers are unchanged.
  - `vectors/VectorIndex.js` (233) **left whole**: one cohesive class
    (add/search/compact/save/load over one FAISS index plus its IRI map);
    splitting would scatter shared private state for no gain.
  - Also extracted `common/store/GraphWriter.js` (batched grouped writes,
    Turtle-file loading) from `IngestPipeline`, so every facet writes the
    same way.
- [x] Move `tests/` to mirror the new layout (`tests/common/…`,
      `tests/gnamgnam/…`); `tests/store/` stays the live-store suite.
      New tests: SearchService + adapter, Router, GraphWriter, facet graph
      kind, common routes (`/health`, `/ns/*.ttl`, 405 on writes).
- [x] `bin/*` scripts: names/flags unchanged; imports updated.
      `bin/retrieve.js` smoke-tested offline: 5,136 URLs classified.
- [x] Add `facet` kind to `GRAPH_KINDS` (`graph:facet/<id>`, user precedence).
- [x] Update `README.md` layout and `docs/enricher.md` paths
      (`docs/tools.md` had no source paths to change).

### Acceptance

- [x] `npm test` passes: 10 files, 62 tests (baseline 43 + 19 new).
- [x] `node bin/serve.js` serves the same results as before — confirmed
      by hand against the live store on 2026-09-26 (branch checked out
      locally, server restarted). Also covered by stub-backed server and
      SearchService tests.
- [x] No file in `src/` over ~200 lines, except `VectorIndex.js` (reason above).

### Behaviour notes

- A non-GET request to an **unknown** path now returns 404 (was 405);
  to a known path it is still 405.
- The `domain` facet filter now uses `literal()` escaping instead of
  stripping quotes — same results for real domains, and safer.

---

## Phase 2 — Shared shell: facet registry, tabs, UI kit

**Goal:** one server hosts every facet; each facet has a mobile-first page
with the tab row on top.

### 2.1 Facet contract (as built)

A facet is a plain object (`src/common/facets/FacetRegistry.js`):

```js
{
  id: 'gnamgnam',             // path segment: /gnamgnam/…
  label: 'GnamGnam',          // tab text
  description: '…',           // one line
  routes (router, { tabs, facet }) { … },  // registers /<id>/… routes
  health () { … }             // optional: status for /health
}
```

`src/facets.js` builds the list explicitly, in tab order (no autoload):
GnamGnam (real, `src/gnamgnam/index.js`) then stubs for Trestle, Farelo,
Wiki, News, Blog, Squirt (`src/common/facets/stubFacet.js` — a page saying
what the facet will be and which phase builds it). A facet's graphs,
vocab, shapes and search adapter will join the contract when a second
real facet needs them (Phase 4+), rather than being guessed now.

### 2.2 Tasks

- [x] `src/common/http/Router.js` — tiny path router on `node:http`
      (method + pattern → handler), with content negotiation reused.
      (Done in Phase 1.)
- [x] `src/common/facets/FacetRegistry.js` — validates facets (id, label,
      routes, no duplicates), mounts their routes, exposes the tab list,
      collects per-facet health.
- [x] `src/common/ui/`:
  - [x] `layout.js` — HTML shell: viewport + `color-scheme` meta, shared
        stylesheet, tab row (`<nav aria-label="Facets">` with
        `aria-current="page"` on the active facet), `<main>`.
  - [x] `public/css/base.css` — colour tokens with a dark set via
        `prefers-color-scheme`, mobile-first layout (16px gutter, 44px
        touch targets), sticky tab row that scrolls sideways on narrow
        screens, search form and result cards.
  - [x] `public/js/tabs.js` — progressive enhancement only: scrolls the
        current tab into view. Pages work without JS.
  - [x] Static serving for `/static/*` (`src/common/http/staticFiles.js`):
        known types only, path-traversal safe, 1h cache.
- [x] `/` redirects (302, query kept) to `app.defaultFacet`
      (new `config/config.json` key, required — no silent default).
      Each facet at `/<id>/`.
- [x] GnamGnam moved under `/gnamgnam/` on the shell; search page
      restyled as cards, keeps the selected type. Old URLs (`/search`,
      `/facets`, `/bookmarks`, `/bookmark/<slug>`) 301 to the new ones.
- [x] `bin/serve.js` boots via `createFacets()` + `createServer({ facets })`.
- [x] `/health` now reports `facets: { <id>: status }`; GnamGnam's entry
      holds the bookmark and vector counts (they were top-level before).
- [x] Tests: router, registry validation/tabs/health, layout (active tab,
      escaping, viewport), static root containment, redirects, stub
      pages, stylesheet serving. 12 files, 76 tests.
- [x] README, `docs/tools.md`, `docs/deployment.md` updated.

### Acceptance

- [x] At 375px (Playwright, stub data): GnamGnam search usable, tab row
      visible and scrollable, no horizontal page scroll; stub tabs for
      all planned facets. Checked light and dark, and at 1024px.
- [x] axe-core 4: no violations on the search page or a stub page, light
      and dark.
- [x] Re-checked against the live store locally on 2026-09-26: search,
      `/health`, old bookmark links redirecting — all working.

---

## Phase 3 — GnamGnam completion

**Goal:** finish the Phase 0 leftovers so bookmarks are genuinely
useful: real titles, summaries, complete vectors.

Split in two: **3a** is code, built and tested in the cloud sandbox
(which cannot reach the web — its proxy refuses GitHub, arXiv, Wikipedia,
archive.org and ordinary sites); **3b** is the long network/Ollama runs,
done locally.

### 3a Tasks (code)

- [x] Richer cataloguing: auxiliary info per type, one table in
      `src/gnamgnam/Catalogue.js` driving serialisation, enrichment patch,
      text view, lexical search and the detail page.
  - URL-derived at ingest: `dim:githubOwner`, `dim:githubRepo`,
    `dim:arxivId`, `dim:wikipediaLanguage`, `dim:wikipediaTitle`.
    On the real corpus: 991 GitHub repos, 169/170 arXiv, 397/398 Wikipedia.
  - API-derived at enrichment (enricher-owned, replaced on each patch):
    `dim:githubLanguage`, `dim:githubStars`, `dim:githubTopic`,
    `dim:arxivAuthor`, `dim:arxivCategory`.
  - Terms went into `vocabs/dim.ttl` rather than a separate
    `vocabs/gnamgnam.ttl` (the vocabulary is still small and shared);
    SHACL constraints in `vocabs/shapes.ttl`.
  - Authors score like a vendor name in lexical search; topics,
    categories and language as body text; all added to the embedding
    text only when present (unchanged text for everything else).
  - `GITHUB_TOKEN` (optional) lifts the GitHub API limit from 60 to 5000
    requests/hour — needed for the ~1k repos.
- [x] Topic concepts (`dim:bookmark-topics` SKOS scheme + facet) — built
      2026-09-26 (after Phase 12): `bin/topics.js` clusters enrichment
      keywords, GitHub topics, arXiv categories and tags (the outline
      contexts stay out: the Workflowy file nests links under links, not
      under topic headings). Terms on ≥ 8 bookmarks and ≤ 25% of them,
      spellings merged, plurals merged only when the singular is used too,
      domains excluded, nesting by 80% containment, most specific topics per
      bookmark; `--dry-run` to review; GnamGnam **Topic** filter and topic
      links on bookmark pages. Checked in the sandbox with synthetic
      keywords (30 topics, 22% of bookmarks). **Run it locally on the real
      keywords.**
- [x] Dead-link handling:
  - Link status derived, not stored (`src/gnamgnam/LinkStatus.js`):
    last status seen (enrichment fetch, else first-pass probe) →
    `ok` / `dead` (404, 410) / `blocked` (401, 403, 429, 451) / `error` /
    `unchecked`. A search facet and filter (`?linkStatus=`), computed in
    memory via new optional adapter hooks `documentFilter` /
    `documentFacets` on `SearchService`.
  - `bin/deadlinks.js`: report by status; `--wayback` looks up the
    Wayback Machine availability API (1 req/s, answers cached in
    `data/cache/wayback.json`) and writes `schema:archivedAt`.
- [x] Bookmark detail page (`/gnamgnam/bookmark/<slug>`, HTML by default,
      JSON/Turtle by suffix or Accept): title, URL, link-status badge with
      HTTP code and archived copy, domain/type links into search, summary,
      key terms, catalogue table, outline context and source line.
      Search cards link to it and flag dead/blocked/error links.
      Inbound cross-links wait for Phase 4.
- [x] **Bug fix — re-ingest lost all enrichment.** `ingest` drops and
      reloads the source graph; `enrich` then found its cache "fresh" /
      "unchanged" and wrote nothing, so `bin/pipeline.sh` silently
      removed every summary for up to 30 days. The enricher now restores
      a cache hit when the store row has no enrichment (status
      `restored`). Reproduced and verified against a real Fuseki: 6
      fetch statuses → 0 after re-ingest → 6 after enrich.
- [x] Every named SPARQL query is now parsed in a test (`sparqljs` as a
      dev dependency).
- [x] Shared CSS: long unbroken titles wrap instead of widening the page.

### 3b Tasks (local runs)

- [~] Set `GITHUB_TOKEN`, then run `bin/retrieve.js --live` over the full
      set — **ran locally, 118 min.** Record the status distribution
      (2xx/3xx/4xx/5xx/timeouts) in the log.
- [x] **Bug fix — ingest halted by a non-standard status.** LinkedIn
      answers crawlers with HTTP 999; the SHACL shapes allowed only
      100–599, so the whole ingest refused. Now any three-digit code is
      recorded (`dim:httpStatus` / `dim:fetchStatus` 100–999), codes ≥ 600
      count as `blocked`, 999 joins the refusal set (one shared set; the
      harvester's duplicate is gone), and the normaliser drops anything
      that is not a three-digit code instead of failing the run.
      Reproduced and verified on the sandbox Fuseki: same error before,
      5,310 bookmarks ingested after.
- [ ] Re-ingest with live data; titles/descriptions and URL catalogue
      details populated. Then `bin/enrich.js` (restores any earlier
      enrichment from cache) and `bin/deadlinks.js --wayback` (restores
      archived copies from cache).
- [ ] Enricher: `--limit 50` sample → manual review (manual gate from
      docs/enricher.md) → full run with `--reembed`. **Local Ollama
      (`qwen2.5:3b`) is too slow on this CPU — every call timed out at
      120s.** Added `--summariser remote` (any OpenAI-compatible API, e.g.
      OpenCode Zen) plus a circuit breaker for both LLM summarisers; the
      sample/full run will use the remote one.
- [ ] Vector index complete (`index.size` == bookmark count, minus logged
      embed timeouts).
- [ ] Re-evaluate `minSimilarity` (currently 0.58) once summaries exist;
      record the nonsense-query score used to justify the new value.
- [ ] `bin/deadlinks.js` report: record dead/blocked/error counts; run
      `--wayback` over the dead ones.
- [ ] Topic concepts: run `node bin/topics.js --dry-run`, then write (see 3a).

### Acceptance

- [ ] ≥ 90% of reachable bookmarks have `dim:summary`. (3b)
- [ ] 10 hand-picked queries: relevant result in top 5 for ≥ 8 (record them). (3b)
- [x] `bin/validate.js` clean on all graphs — verified on a real Fuseki
      5.6 in the sandbox after ingest, enrichment and a Wayback patch;
      re-check after 3b.
- [x] Code: 15 test files, 114 tests; detail page, dead-link search and
      a GitHub detail page at 375px (light/dark) with no horizontal scroll
      and no axe violations.

### Notes

- `bin/pipeline.sh` does not run `deadlinks --wayback`; after a
  pipeline re-ingest, run it once to restore archived copies.
- Real Fuseki in the sandbox: Apache Jena Fuseki 5.6 with the project's
  own assembler (`config/fuseki/assembler-tdb2.ttl`), started from the
  scratchpad — useful for future store-level checks.

---

## Phase 4 — Write path & cross-linking foundation

**Goal:** facets can create/edit data safely, and anything can link to
anything.

Decisions (2026-09-26): links live in one shared graph (Q1); writes are
protected by one token from `.env` plus a browser session with CSRF (Q5).
Proved on GnamGnam: the owner's tags and notes on bookmarks, and links
from the bookmark detail page.

### 4.1 Write path

- [x] `src/common/store/Repository.js` — validated writes into a facet's
      own graph (`graph:facet/<id>`, registered on first write, licence
      `personal-data`). `replace` (owned properties of one resource),
      `add`, `remove`. The resource's current triples are read, the change
      applied in memory and SHACL-validated **before** anything is written;
      a rejection is a 422 with readable reasons. User data never goes in
      a source graph (an ingest reloads those) — verified: notes, tags and
      links survive a full re-ingest.
- [x] HTTP writes: `POST` routes (not PUT/PATCH/DELETE — HTML forms only
      speak GET/POST, and one verb keeps both clients on the same path).
      `src/common/http/write.js`: forms get a 303 back to a local page
      (`_return`, open-redirect safe); JSON clients get JSON. Bodies are
      forms or JSON, size-capped (`body.js`).
- [x] Auth (`src/common/http/auth.js`): `DIM_WRITE_TOKEN` (16+ chars) in
      `.env`. Scripts send it as `Bearer` or the Basic password; browsers
      log in at `/login` → HttpOnly, SameSite=Strict session cookie (30
      days, in memory — a restart logs you out) and a per-session CSRF
      token checked on every form write. No token → read-only, and writes
      say why. Constant-time comparison; a failed login waits 750 ms.
- [x] Change log (`src/common/store/ChangeLog.js`): each write is a
      `prov:Activity` in `graph:system/changes` — who, when, action,
      resource, graph, properties, a one-line summary.

### 4.2 Cross-linking

- [x] Link vocabulary in `vocabs/dim.ttl`: `dim:relatedTo` (symmetric),
      `dim:resource`, `dim:mentions`, `dim:partOf`; plus `dim:note` and the
      change-log terms. SHACL: `TaggedShape`, `NotedShape`, `LinkShape`
      (target by property, since facet graphs carry no `rdf:type`).
- [x] Links stored in **`graph:facet/links`** (Q1) — `src/common/links/LinkStore.js`;
      one query reads both directions; `related` shows once on both ends.
- [x] Markdown references (`src/common/links/mentions.js`): `[[type/slug]]`,
      `[[Title]]` (resolved by the facets), `/r/…` paths and DIM page URLs
      become `dim:mentions` on save; references inside code are ignored.
      Pasted URLs of bookmarked pages resolve to the bookmark.
- [x] Resolver: `/r/<type>/<slug>` and `/r?iri=` → the owning facet's page
      (facets declare `types`). Content negotiation per resource stays
      with the facet (bookmarks: HTML / `.json` / `.ttl`).
- [x] Links panel (`src/common/ui/linksPanel.js`), grouped by kind and
      direction (Related, Resources / Used by, Part of / Contains,
      Mentions / Mentioned by), remove buttons, add form. On the bookmark
      detail page now; reusable by every facet.
- [x] Cross-facet search: `/find` (page) and `/find.json`, via the new
      facet hooks `find`, `lookup`, `lookupUrl`, `lookupTitle`.
      (`/search` was taken by a permanent redirect from Phase 2.)
- [x] Link picker (`/static/js/linkpicker.js`): type-ahead over `/find.json`,
      keyboard-operable combobox; without JS the field takes a URL, IRI or
      `[[type/slug]]`.
- [x] Safe Markdown (`src/common/ui/markdown.js`): raw HTML shown as text,
      only http(s)/mailto/local link targets, `[[…]]` linked.
- [x] Also: search falls back to lexical-only when Ollama is unreachable,
      instead of failing.

### Acceptance

- [x] Edit through the UI (Playwright, 375 px): log in (wrong token shows
      an error), save tags + a note, add a link with the picker, remove
      one, log out. Raw HTML in a note is escaped. axe clean on the
      detail, find and login flows; no horizontal scroll.
- [x] SHACL rejects invalid writes with a readable error (upper-case tag
      → 422 "Tags are short and lower-case."), nothing written.
- [x] A link added on one resource shows on the other as "Mentioned by" /
      "Used by" (verified on the live store).
- [x] Store tests cover Repository and LinkStore round-trips
      (`tests/store/writes.test.js`, 5 tests, sandbox Fuseki 5.6).
- [x] `bin/validate.js`: every graph conforms, including
      `graph:facet/gnamgnam`, `graph:facet/links`, `graph:system/changes`.
- [x] 174 core tests.
- [x] Re-checked on the local machine with `DIM_WRITE_TOKEN` set (2026-09-26).

### Notes

- Sessions are in memory: restarting the server logs you out.
- Deleting a *resource* waits for a facet that owns resources (Trestle,
  Farelo); bookmarks come from the outline, so they are not deleted in DIM.
- History view of the change log is not built yet (task pages in Phase 6
  are the first consumer).

---

## Phase 5 — Trestle outliner

**Source:** [danja/trestle](https://github.com/danja/trestle) (reviewed read-only).
**Graph:** `graph:facet/trestle`. Command reference: `docs/commands-trestle.md`.

### Review of danja/trestle

What carried over: the model (title, Markdown description, parent,
sibling order, created), Workflowy keys (Enter / Tab / Shift-Tab /
arrows), zooming into a node with breadcrumbs, a card (detail) view, and
the goal of a Workflowy-like outliner over RDF. What did not: the Vite
bundle, the browser-side RDF model (rdf-ext in the page), the EventBus
MVC and its 600–950-line files, the `ts:`/`prj:` vocabularies and the
node-type selector (Project/Task/Node — tasks belong to Farelo), drag and
drop (keyboard, buttons and the touch toolbar cover moving). Rebuilt on
DIM's shared parts instead: server-rendered pages, the Phase 4 write path,
links and shapes.

### Tasks

- [x] Review trestle (above).
- [x] Model: `dim:Outline`, `dim:OutlineNode`; `dim:partOf` parent (a node,
      or the outline at top level); `dim:inOutline`; title `dcterms:title`
      (inline Markdown); note `dim:note` (the plan said `dim:content` — the
      shared note term already exists); `dim:collapsed`;
      `dcterms:created` / `modified`; `dim:sourceLine` from imports. SHACL
      `OutlineShape`, `OutlineNodeShape`.
- [x] **Ordering (Q2): `dim:position`, a fractional `xsd:decimal`** — an
      insert or move takes the midpoint of its neighbours and rewrites one
      node; siblings are respread (1, 2, 3 …) only when a gap drops below
      1e-6. An `rdf:List` would rewrite list cells on every move and is
      awkward to query.
- [x] Workflowy parser fix: a shared `src/common/outline/OutlineParser.js`
      joins wrapped link titles (`[` / title / `](url)`), nests by
      indentation, repairs a title missing its `[`. The bookmark harvester
      now uses it: same 5,325 URLs, 76 more with link text, and contexts
      are real ancestors ("Software Projects / Seki") instead of fragments.
- [x] Import `data/workflowy.md` (`bin/trestle-import.js`): 8,118 items,
      128 top level, SHACL-validated as a whole, 12 s; 5,819 `dim:resource`
      links to existing bookmarks (joined by minting the bookmark IRI from
      the URL — more exact than `dim:sourceLine`). Parents start collapsed.
      Refuses to overwrite without `--replace`.
- [x] Outliner UI (`src/trestle/`, `/static/js/outliner.js`): server-rendered
      tree; zoom + breadcrumbs; ▸/▾ collapse; ⌗ to the linked bookmark.
      Logged in: click a title to edit; Enter new item, Tab / Shift-Tab,
      ↑/↓, Alt+↑/↓, Backspace on empty deletes, Esc; a touch toolbar with
      the same actions; every action also has a no-JS form on the item
      page. Links panel on item pages; notes' `[[references]]` become
      mentions.
- [x] Saving: each edit goes through the Phase 4 write path immediately
      (on Enter/blur/move, not a debounced PATCH); after a structural
      change the visible tree is re-fetched, so the page never drifts.
- [x] Export: Markdown (outline and subtree) and Turtle (outline).
- [x] Cross-facet: `/find` searches outline items; a bookmark's page shows
      the outline items using it (**Used by**).
- [x] Tests: outline parser, tree moves, import plan, decimal literals and
      node shapes (offline); OutlineStore create/edit/move/delete/reload and
      renumbering against the store.

### Acceptance

- [x] Workflowy outline browsable with bookmarks one click away (⌗ on each
      item; the item's title keeps its own link).
- [x] Edit → reload → edits persist (Playwright: Enter, Tab, Shift-Tab,
      Alt+↑, Backspace, note, collapse; reload shows the same tree).
- [x] Export round-trips: the Markdown export of the imported outline parses
      back to the same 8,118 items, 0 differences; the Turtle export parses
      to the same 57,834 triples.
- [x] axe clean, no horizontal scroll at 375 px (outline, item, editing).
- [x] `bin/validate.js` clean including `graph:facet/trestle`.
- [x] 190 core tests, 7 store tests.
- [ ] Local check: import on your machine, then edit in the browser.

### Notes

- Outlines are cached in memory by the server: restart it after
  `bin/trestle-import.js`.
- Re-importing with `--replace` drops web edits to that outline.
- The old outline context for bookmarks changed with the parser fix; it
  refreshes on the next `bin/ingest.js`.

---

## Phase 6 — Farelo (Kanban + Getting Things Diced)

**Graph:** `graph:facet/farelo`. This is the todo graph at the heart of
the ultimate aim.

### Tasks

- [x] Read the "Getting Things Diced" post — local copy at
      [`docs/Getting Things Diced – hyperdata.it.html`](Getting%20Things%20Diced%20–%20hyperdata.it.html)
      (Danny Ayers, hyperdata.it, 2015-05-11). Method summarised in 6.1.

### 6.1 Getting Things Diced — the method

A chance-based way to pick the next task that still respects priorities.

1. List about 11 tasks.
2. Give each a relative priority, 1 (high) … 11 (low). Fewer than 11 tasks →
   leave out the higher numbers; more than 11 → the lowest-priority tasks
   stay unnumbered (not in the draw).
3. Map priority → target (the sum of two dice), so the most likely sums go
   to the highest priorities:

   | Priority | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | Target (2d6 sum) | 7 | 6 | 8 | 5 | 9 | 4 | 10 | 3 | 11 | 2 | 12 |
   | P(target) | 16.67% | 13.89% | 13.89% | 11.11% | 11.11% | 8.33% | 8.33% | 5.56% | 5.56% | 2.78% | 2.78% |

4. Roll two dice; do the task whose target equals the sum.
5. Afterwards, whichever suits: replace that task/target with another, ignore
   that target on the next roll (re-roll if hit), or write a whole new list.

If a sum hits an empty target (fewer than 11 tasks), roll again. The
target order works out to 7, then alternating either side of 7
(6, 8, 5, 9, …), which gives each successive priority the same or a lower
probability.

- [x] Model (`vocabs/dim.ttl`, `src/farelo/rdf.js`): `dim:Task`, `dim:Project`
      (a task others are `dim:partOf`); `dcterms:title`, `dim:note`,
      `dim:status` → SKOS concepts in `dim:task-states` (backlog, todo,
      doing, blocked, done; written to `graph:alignment/task-states`),
      `dim:priority` 1–5, `dim:due`, `dim:estimate` (minutes),
      `dim:dependsOn`, `dim:position` (column order), `dim:doneAt`.
      **Contexts are tags** (`dim:tag`, e.g. `@home`) rather than a
      separate SKOS scheme — the same mechanism as bookmark tags.
      `TaskShape` in SHACL. Every write rewrites the task's whole
      description, so a task is always valid as a unit.
- [x] Board (`/farelo/`): five columns; on a phone one column at a time
      (scroll-snap + column chips); drag by the ⠿ grip (pointer events, so
      touch works without hijacking scroll), Alt+←/→/↑/↓ on a focused card,
      and a no-JS **Move** menu. **Projects are a filter, not swimlanes** —
      swimlanes don't fit a phone. Moves into Doing/Done are refused while
      a dependency is unfinished (409, message shown on the board).
- [x] Dice (`src/farelo/dice.js`, pure; RNG injected):
  - [x] `diceList` numbers up to 11 eligible tasks — To do or Doing, not a
        project, no unfinished dependency — sorted by priority, due date,
        age (`rankForDice` in `tasks.js`).
  - [x] `roll`, `pick` (re-rolls empty or skipped numbers), `probability`,
        and a seeded generator for tests.
  - [x] After-pick policies *replace*, *skip*, *new* (`nextState`). The
        round's state travels in the form, so the server stays stateless.
  - [x] Page: numbered list with targets and chances, Roll (tumbling dice,
        off under reduced motion), result with **Start it**, policy choice,
        **Print the list** (print stylesheet).
  - [x] Each roll recorded as a `dim:Roll` / `prov:Activity` in
        `graph:system/rolls` (dice, sum, picked task, rank, policy, list
        size). Rolling needs a login, since it writes.
- [x] Task page: state buttons, meta, waits-on list, project's tasks, note,
      links panel (resources one click away), edit form, delete, history
      from the change log.
- [x] Import (`bin/farelo-import.js`): items under TODO headings in the
      outline → 144 tasks (40 projects) from the Workflowy outline, each
      linked to its outline item; link-only items skipped; re-runs add only
      new ones and relink by title (safe after `trestle-import --replace`).
      Tasks start in Backlog (old to-dos are candidates; the dice draw from
      To do and Doing).
- [x] Also: the outline parser now treats a `# heading` between bullets as
      a top-level item (the Workflowy file has two); ordering helpers moved
      to `src/common/store/positions.js`, shared by Trestle and Farelo.
- [x] Tests: target table and chances; **36,000 seeded rolls within 1% of
      the 2d6 odds**; re-roll on empty/skipped; each policy; eligibility
      (blocked, waiting, backlog, done, project never offered); transition
      refusal; ordering; TODO-section planning; the dice route with a
      seeded RNG; TaskStore round-trip against the store.

### Acceptance

- [x] Board usable on phone and desktop; moving a card persists (Playwright:
      drag to Doing, Alt+→, refusal message, reload keeps the order; axe
      clean, no horizontal page scroll at 375 px and 1280 px).
- [x] Dice pick never returns a blocked or dependency-pending task (unit
      tests + route test over 20 live rolls).
- [x] Pick frequencies match the 2d6 distribution (36k rolls, all within 1%).
- [x] `bin/validate.js` clean including `graph:facet/farelo`,
      `graph:system/rolls`, `graph:alignment/task-states`.
- [x] 208 core tests, 9 store tests.
- [ ] Local check: `bin/farelo-import.js`, then the board and a few rolls.

### Notes

- `trestle-import --replace` drops links to the old outline items; run
  `farelo-import` again to relink tasks.
- Tasks are cached in memory by the server: restart after an import.

---

## Phase 7 — Wiki (from foowiki)

**Source:** `~/github/foowiki` (danja/foowiki). **Graph:** `graph:facet/wiki`.

### Tasks

- [x] Review foowiki: a client-side wiki over a SPARQL store. Page IRI per
      title; `dc:title`, `sioc:content` (Markdown), `dc:date`,
      `foaf:maker`, tags; links between pages are relative
      `[text](Page Title)`; no history, no server. Ported: the vocabulary
      (`sioc:content`), Markdown bodies, title-based linking. Not ported:
      the client-side store access (DIM writes through the server).
- [x] Model: `dim:WikiPage` (slug IRI `dim:page/<slug>`; `dcterms:title`,
      `sioc:content`, `dim:tag`, created/modified, `dim:revisionNumber`,
      `dim:currentRevision`). Every save also writes a full-text
      `dim:PageRevision` (`prov:Entity`; `dim:revisionOf`, number,
      `prov:wasRevisionOf` the previous one, author). SHACL shapes for both.
      Tags are plain `dim:tag` literals, as in GnamGnam and Farelo, not SKOS
      — one tag vocabulary across facets is a later clean-up.
- [x] Rendering: the shared safe Markdown renderer, now with a `titleHref`
      option — `[[Title]]` goes to that wiki page, or (dashed red) to a
      "no page yet — create it" page; `[[type/slug]]` goes to anything.
      Fixed on the way: `[[…]]` inside inline code was being linked.
- [x] Edit UI: title, text, tags; **Preview** rendered by the server (no JS
      needed); conflict detection by revision number — a stale save is a
      409 page that keeps your text, rebases the form on the latest
      revision and shows what the other save changed.
- [x] Mentions: every save syncs `dim:mentions` (wiki titles first, then
      any facet's titles); creating a page links the earlier `[[Title]]`s
      that were waiting for it. Backlinks show as **Mentioned by** in the
      links panel.
- [x] History (every revision, author, time), any revision's text, and a
      line diff between revisions (LCS, `src/common/text/diff.js`; long
      unchanged runs folded).
- [x] Facet hooks: `/find` (title, text, tags), `lookup`, `lookupTitle`,
      `/r/page/<slug>`; exports `.md`, `.ttl` (page + revisions), `.json`.
- [x] Import (`bin/wiki-import.js`): a foowiki Turtle dump or a folder of
      `.md` files (front matter / `# heading` / file name for the title);
      links between imported pages become wiki links; a re-run adds a
      revision only where the text changed.
- [x] `/find` no longer fails outright when one facet's search throws
      (e.g. Ollama down): that facet shows "search unavailable".
- [x] Tests: link parsing and create-on-follow hrefs, sanitisation, inline
      code, revision numbering and 409, SHACL for page and revision, diff
      and folding, import rewriting (foowiki and Markdown), routes
      (preview, conflict form, login, mention sync, `/find`), and the
      store round-trip (revisions, reload, delete).

### Acceptance

- [x] Create/edit/link pages; backlinks shown; history viewable
      (Playwright: follow a missing `[[Title]]` → create → preview → save;
      backlinks; two editors → conflict page → save; history; diff;
      delete. axe clean, no horizontal scroll at 375 px light/dark and
      1280 px).
- [x] `bin/validate.js` clean including `graph:facet/wiki`.
- [x] 223 core tests, 10 store tests.
- [ ] Local check: `bin/wiki-import.js` on the foowiki dump (or a notes
      folder), then create and edit a page.

### Notes

- Pages are cached in memory by the server: restart after an import.
- Renaming a page keeps its slug (the IRI is stable); `[[New title]]`
  finds it by title.

---

## Phase 8 — Newsmonitor (RSS)

**Source:** `~/github/NewsMonitor` (danja/NewsMonitor). **Graphs:**
`graph:facet/news` (subscriptions, poll status, your read/starred flags) +
`graph:source/news` (items; `proprietary-linkout`) — one source graph for
all feeds rather than one per feed: every feed's items have the same
standing (third-party, link out, expire).

### Tasks

- [x] Review NewsMonitor: a Java (OSGi/Stanbol-era) aggregator — RSS 1/2,
      Atom and OPML parsers, a poller, feeds and entries as RDF
      (`nm:` vocabulary, entry bodies as Markdown), preset keyword "topics"
      scoring relevance, feed discovery by crawling pages; plus a 2023
      Node feed-grabber and the curated feed lists. Ported: the feed model,
      formats, discovery, OPML, the feed lists (importable as-is). Not
      ported: the keyword topic scoring (the advisor, Phase 11, can use
      embeddings instead) and link-crawling discovery.
- [x] Model: `dim:Feed` (URL, title, site, tags, format, poll status, ETag /
      Last-Modified, failures, next poll) and `dim:FeedItem` (feed, title,
      link, guid, published, first seen, text, author, categories); SHACL
      shapes. Read/starred are `dim:read` / `dim:starred` on the item IRI in
      the facet graph. Subscription edits go through the Repository
      (validated, change-logged); poll status and flags are written directly
      (operational, not worth a change-log entry each).
- [x] Parsing (`fast-xml-parser`, the one new dependency): RSS 2.0, RSS 1.0,
      Atom, JSON Feed; CDATA, HTML titles, relative links, missing guids;
      the fuller of description/content; HTML → text (`src/common/text/html.js`);
      IRI-safe links; empty items dropped; charset from header/XML
      declaration.
- [x] Fetching lifted to `src/common/http/fetch.js` (a real streaming byte
      cap, charset decoding, status/content-type helpers; the enricher
      re-exports them).
- [x] Poller: conditional GET, honest user-agent, one request per host at a
      time with a pause, 4 hosts in parallel, doubling back-off (up to a
      day), Retry-After, 410 stops polling, refusals recorded, 100 items per
      poll, first poll marks items older than 14 days read, one run at a time.
- [x] Scheduling: `bin/news.js poll` one-shot; `NEWS_POLL_MINUTES` runs it
      in the server (and prunes daily). Off by default.
- [x] Reader UI: river (unread/starred/all, by feed or tag, paging), read/star
      in place (JS) or by form, opening an item marks it read, mark page
      read; item page (text, original, links); feeds page (subscribe by
      site or feed URL with discovery, import pasted OPML/URL list, poll,
      OPML export); feed page (status, last error, next poll, settings,
      items, unsubscribe). JSON: `/news/items.json`, `.json` on items/feeds.
- [x] Save as bookmark (→ `graph:facet/gnamgnam`, survives re-ingest,
      searchable at once via a new `refresh` facet hook and
      `SearchService.loadDocument`) and make task (→ Farelo To do); both
      star the item and link it both ways.
- [x] OPML import/export; plain URL lists (NewsMonitor's `feedlists/*.txt`).
- [~] Items searchable: `/find` matches titles and text lexically. Not
      embedded: item volume and churn make vectors poor value now; saved
      bookmarks get vectors the usual way. Summarisation left out likewise.
- [x] Retention: `prune` (90 days, starred kept), daily when polling in the
      server.
- [x] Tests: fixtures for each format, HTML-to-text, discovery, OPML
      round-trip, SHACL for feeds/items, poller (conditional GET, first-poll
      read marking, back-off, 410, Retry-After, network errors, due/force,
      single run), routes (discovery subscribe, flags, paging, OPML,
      bookmark, task, import, find, health), store round-trip on Fuseki.

### Acceptance

- [~] 20+ feeds polling reliably: verified against a local feed server
      (RSS + Atom + 410 + malformed; conditional GET answered 304 on the
      second run). This sandbox has no internet access, so real feeds are
      part of the local check.
- [x] Unread counts correct (route + browser checks, mark-all → 0).
- [x] One-click bookmark/task creation works, linked both ways (Playwright).
- [x] `bin/validate.js` clean including `graph:facet/news`, `graph:source/news`.
- [x] 243 core tests, 11 store tests; Playwright + axe clean, no horizontal
      scroll at 375 px (light/dark) and 1280 px.
- [ ] Local check: `bin/news.js import` a real feed list, `poll`, read in
      the browser; optionally `NEWS_POLL_MINUTES`.

### Notes

- Changes from `bin/news.js` need a server restart to show (cached in
  memory); polls run by the server don't.
- Duplicate stories across feeds are kept apart (dedupe is per feed, by
  guid, else link).

---

## Phase 9 — Blog engine

**Graph:** `graph:facet/blog`. Depends on Wiki (Markdown pipeline).

### Tasks

- [x] Model: `dim:BlogPost` (title, `sioc:content` Markdown, `dim:slug`,
      `dim:postStatus` draft/published, `dcterms:issued` set on first
      publishing and kept thereafter, optional abstract, tags,
      `prov:wasDerivedFrom` its source); SHACL shape. Rendering reuses the
      shared Markdown renderer, which gained `localHref` (map or unlink
      local links), `titleHref` → null (plain text), and relative hrefs.
- [x] Authoring: new drafts by title; **Draft a blog post** on wiki pages
      and outline items (outline: note + subtree as a Markdown list); a
      `related` link back to the source. Editor with server-rendered
      preview; publish / unpublish / delete.
- [x] Public views: index, `/blog/YYYY/MM/DD/slug` (wrong date → 301),
      prev/next, tag pages, Atom feed (20 latest). Drafts: owner only —
      404 for anyone else, never in the feed, `/find` or the export.
- [x] Static export (`bin/blog-export.js`): index, dated post dirs, tag
      pages, `feed.atom`, `style.css`; relative links; links into the rest
      of DIM become text; replaces only a directory it made (marker file).
- [x] Also: a handler's thrown 4xx (e.g. "No such post") now answers with
      that status instead of 500 — this also fixes the wiki's history,
      revision and diff routes for unknown pages.
- [x] Tests: date paths, slug uniqueness, publish date kept across
      unpublish/republish, link mapping (public vs app), feed well-formed
      (XML validator) and readable by our own feed parser, drafts excluded
      everywhere, export file set and relative links, routes (draft 404,
      publish, redirects, tags, feed, draft from wiki page), relative/mapped
      links in the renderer, store round-trip.

### Acceptance

- [x] Drafts invisible publicly (route tests + browser logged out: 404,
      absent from index, feed and find).
- [x] Export produces a valid static site + feed (feed parses as XML and
      as Atom; site browsed over HTTP: relative links work; axe clean, no
      horizontal scroll at 375 px and 1280 px, light and dark).
- [x] 252 core tests, 12 store tests.
- [ ] Local check: draft from a wiki page, publish, export, preview.

---

## Phase 10 — Squirt: mobile view of everything

**Source:** `~/github/squirt` (danja/squirt).

### Tasks

- [x] Review squirt: a vanilla-JS plugin-based PWA "for posting information
      to the web" — post creation with metadata, wiki, chat, SPARQL,
      Excalidraw; installable, a GET share target (url/title/text), a
      bookmarklet, a network-first service worker. Ported: the share
      target, bookmarklet, manifest and network-first worker, and the idea of
      one place to post from. Not ported: its own wiki/SPARQL/drawing
      views (DIM's facets are those) and the plugin system (the facet
      registry plays that part).
- [x] Unified timeline ("Lately"): the latest change to each resource from
      the change log (every facet writes there; link bookkeeping and the
      poller left out; deleted things skipped) plus a new facet hook
      `recent()` (News: newest unread items). Logged in only — it would
      otherwise show drafts' titles.
- [x] Quick capture: one box; `todo …` → Farelo task, a URL → GnamGnam
      bookmark (searchable at once), else a note at the top of the wiki
      Inbox; **Save as** overrides. Bookmark creation shared with News
      (`src/gnamgnam/saveBookmark.js`).
- [x] Web App Manifest (icons 192/512/maskable/SVG, shortcuts), service
      worker at `/squirt/sw.js` with scope `/` (network first, last copy of
      each opened page kept, 300 max, offline page, never login/logout/
      writes), cleared on logout; share target `/squirt/share` (GET) and a
      bookmarklet, both opening a pre-filled capture form with a guess.
- [x] Cross-facet search as the first control on the page.
- [x] Tests: classification (tasks, URLs in text as Android shares them,
      notes, overrides), captures into each facet (Inbox newest first),
      manifest, worker headers, share page (guess, login return), timeline
      hidden from strangers.

### Acceptance

- [x] Installable: Chrome's own check (`Page.getInstallabilityErrors`) is
      empty and the manifest has no errors; the worker controls the page;
      with the server stopped, opened pages still read and unopened ones
      show the offline page (Playwright, persistent profile).
- [x] Capture from the share target lands in the right facet (share URL →
      bookmark; tasks and notes from the box) — browser checks; axe clean,
      no horizontal scroll at 375 px.
- [x] 259 core tests, 12 store tests.
- [ ] Local check on a real phone: needs DIM behind https (Phase 12); then
      install, and Share → DIM from another app.

### Notes

- A phone on the LAN over plain http gets the pages but not install or
  offline: browsers require a secure context.

---

## Phase 11 — "What next?" advisor

**Goal:** the system tells me what to do next to make best use of my
time/resources.

### Tasks

- [x] Inputs: ready tasks (Farelo's dice eligibility), priority, due date,
      estimate vs time available, `@context` tags vs where I am, whether
      it's under way, how many tasks wait on it, linked resources, age,
      recent skips. Device/location are covered by the `@context` choice
      rather than sensed.
- [x] Scoring v1 (`src/advisor/score.js`, pure): Σ weight × feature, every
      suggestion lists its reasons with points; ties broken by the board
      order (priority, due, age); a close call (top two within 5%) offers
      the dice.
- [x] Related resources for the top suggestion: its links, plus other
      facets' matches for its topic words (two thirds of them, whole words;
      verbs such as "write", "fix" ignored) — plain search was too loose.
- [x] Optional LLM pass: "Ask an LLM to talk it through" sends the top five
      titles and reasons to the enrichment LLM settings; advisory only,
      shown under the list.
- [x] Feedback in `graph:facet/advisor`: "Not now" records a skip that
      pushes the task down for a few days; "Do this now" moves it to Doing
      and, if it wasn't the top, nudges the weights toward where it beat the
      ones above (perceptron step, weights kept within 0.1–6); weights
      shown and resettable.
- [x] Shown at `/farelo/next` (linked from the board) and as **Next up** on
      Squirt.

### Acceptance

- [x] Given a seeded fixture, suggestions are deterministic and explained
      (exact order, reasons and points asserted); a skip changes later
      ordering (fixture + live: the skipped top task drops to second).
- [x] 272 core tests, 13 store tests; Playwright + axe clean at 375 px and
      1280 px.
- [ ] Local check: tag tasks with `@contexts` and estimates, try a few days
      of "Do this now" / "Not now", see the weights move.

---

## Phase 12 — Operations (ongoing)

- [x] Backups (`bin/backup.js`): the whole store as gzipped TriG from the
      Graph Store endpoint, the vector index, optionally `data/cache`;
      timestamped directories with a checksummed manifest; keeps the newest
      14. `bin/restore.js` verifies the checksum, saves the current state
      first, replaces the dataset. Nightly via host cron (compose bind-mounts
      `./backups`). **Restore drill done** on the sandbox store: dropped a
      graph, restored, per-graph triple counts identical (17 graphs).
- [x] Healthchecks: Fuseki, Ollama and now the app in compose; `/health`
      checks the store and every facet, answering 503 "degraded" on a
      failure (verified with the store stopped).
- [x] Structured logging: `LOG_FORMAT=json` (one object per line, fields +
      stack), `LOG_LEVEL`, `LOG_REQUESTS=1` for an access line per request.
- [x] CI: `.github/workflows/ci.yml` runs `npm test` (offline suite) on
      push and pull request.
- [x] Security review (`docs/security.md`): added `DIM_PRIVATE=1`
      (owner-only reads), strict CSP + framing/sniffing/referrer headers
      (checked against every page in a browser), `private, no-cache` on all
      responses, `Secure` cookie behind https, a link-injection fix in
      Squirt, status-only health for strangers. Fuseki stays on loopback;
      no raw SPARQL from requests.
- [x] Docs in step: `docs/deployment.md` (settings, https for the phone via
      Tailscale or Caddy, backups and the drill, health and logs),
      `docs/tools.md`, README status.
- [x] CI's first runs on GitHub passed, including the native `faiss-node` build (2026-09-26).

## Phase 13 — Cross-facet contact

**Goal:** the facets recognise each other's data, not only at the moment
something is imported, saved or drafted. Seven kinds of overlap
(2026-09-27 review): URLs and domains, meaning (text), topics and tags,
projects, the flow of work, time, people.

### Tasks

- [x] 13.1 **URL matching everywhere:** "already bookmarked" on news items
      and captures; a feed shows your bookmarks from its site, and a
      bookmark shows (or offers) its site's feed; dead-link warnings for URLs
      in wiki pages and blog posts, and from the blog export.
      *Done:* registry hooks `aboutDomain(host)` and `urlStatus(url)`
      (GnamGnam, News); news river/item/feed pages; bookmark page (its feed,
      or "Look for this site's feed"); Squirt share; `Links to check` on wiki
      pages, blog posts and the blog preview (owner); export warnings.
- [x] 13.2 **Close the one-way gaps:** blog posts record their `[[…]]`
      mentions; bookmark pages say where a bookmark came from
      (`dcterms:source`, e.g. the news item). *Done.*
- [x] 13.3 **One vector index for every facet:** wiki pages, tasks, outline
      items, posts and news items embedded beside bookmarks (as they're
      saved; news on arrival, pruned with it); "Related" across facets on
      detail pages; news ranked by interest; the advisor's "to hand" uses it.
      *Done:* `RelatedIndex` (second FAISS index beside the bookmarks',
      state file of text hashes, sync embeds only changes and forgets what
      went, news interest = nearest of your own things); facet hook
      `documents()` (published posts only); **Related** on bookmark, wiki,
      task, outline-item, post and news-item pages; News **For you**;
      advisor "to hand" by meaning first; `bin/related.js` + server sync
      every `RELATED_SYNC_MINUTES`; quiet for 5 min when Ollama is down.
      Composition moved to `src/app.js` (server and tools share it). Sandbox
      run with a stand-in embedder: 5,781 items, 10 s; rerun embeds nothing.
- [x] 13.4 **Topics as the shared vocabulary:** topics assigned beyond
      bookmarks; tags aligned to topics; a topic hub page.
      *Done:* topic code moved to `src/common/topics/`, graph renamed
      `graph:alignment/topics` (not yet run on real data, so nothing to
      migrate); `assignByText` gives topics to other facets by whole-word
      names (title counts double; score ≥ 2); `TopicStore`; `/topics` tree
      and `/topics/<slug>` hub grouped by facet; tag pages link the topic of
      the same name; Related panels list topics. Sandbox: 29 topics, given to
      1,414 outline items, 12 tasks, 15 news items.
- [x] 13.5 **Project hub:** a Farelo project gathers its tasks and the
      pages, outline items, bookmarks, feeds and posts linked `partOf` it.
      *Done:* project pages show progress, last activity, everything linked
      *part of* it by facet, the resources its tasks use, and an **Add** box
      (links a picked item *part of* the project); the advisor gains a
      *Quiet project* reason (no activity for 14+ days).
- [x] 13.6 **Day view:** what was saved, read, written and done on a day,
      from the change log; a weekly review. *Done:* `/day[/date]` (changes
      collapsed per resource, by facet, plus a facet `day()` hook — news
      arrivals), `/week[/date]` (Monday start; counts and highlights read
      from change summaries); owner only; linked from Squirt.
- [ ] (later) People: authors across papers, repositories and feeds.

### Acceptance

- Each contact is visible from both ends, and is covered by tests and a
  browser check.

---

## Open questions

| # | Question | Raised | Decision |
|---|---|---|---|
| Q1 | Links in a shared `graph:facet/links` or in the owning facet's graph? | Phase 4 | Shared `graph:facet/links` (2026-09-26). |
| Q2 | Outline ordering: `dim:position` numbers or `rdf:List`? | Phase 5 | Fractional `xsd:decimal` `dim:position`; renumber a sibling list only when a gap < 1e-6 (2026-09-26). |
| Q3 | Source repos (trestle, NewsMonitor, foowiki, squirt) are not in this sandbox — add them to the session / vendor snapshots when those phases start. | 2026-09-26 | Resolved: read-only clones of the public repos for each review. |
| Q4 | Getting Things Diced method — needs a local copy of the post. | 2026-09-26 | Resolved: copy in `docs/`, method in 6.1. |
| Q5 | Write auth model for localhost: token vs Basic vs none-on-loopback. | Phase 4 | `DIM_WRITE_TOKEN` as Bearer/Basic; browser session + CSRF (2026-09-26). |

---

## Work log

Newest last. One line per meaningful step: date · phase · what · ref.

| Date | Phase | Entry | Ref |
|---|---|---|---|
| 2026-09-08 | 0 | Core port, 5,121 bookmarks stored, hybrid search live. | 8adb9d9 |
| — | 0 | Second-pass enricher. | d06e4fb |
| — | 0 | Docs. | 7a44995 |
| 2026-09-26 | — | Created this detailed plan from `docs/plan.md`. | bcd0263 |
| 2026-09-26 | 6 | Getting Things Diced post added to `docs/`; method written into Phase 6. | 6273a99 |
| 2026-09-26 | 1 | Baseline `npm test`: 6 files, 43 tests pass. | |
| 2026-09-26 | 1 | Moved code into `src/common` + `src/gnamgnam`, imports fixed, 43/43. | c4a9cb1 |
| 2026-09-26 | 1 | SearchService adapter, server split + Router, GraphWriter, Summarisers/Fetchers split, `facet` graph kind, docs. 62/62 tests. Live-store check pending. | e93f90d |
| 2026-09-26 | 1 | Live check: search on the restructured branch works as before. Phase 1 done. | |
| 2026-09-26 | 2 | Facet registry, shared shell with tabs, `/static`, GnamGnam at `/gnamgnam/` with redirects, stub facets. 76/76 tests; 375px screenshots and axe clean. Live check pending. | f96f490 |
| 2026-09-26 | 2 | Live check: shell, search, `/health` and redirects work against the live store. Phase 2 done. | |
| 2026-09-26 | — | Found the Phase 2 "done" commit missing from `main` (pushed after the merge); re-applied. | |
| 2026-09-26 | 3 | 3a: catalogue details, link status + `bin/deadlinks.js` (Wayback), bookmark detail page, fix for re-ingest losing enrichment, query-parse tests. 114/114 tests; verified on a local Fuseki 5.6 (ingest 5,121, SHACL clean). Topics deferred. | 52ca784 |
| 2026-09-26 | 3 | 3b: `retrieve --live` ran locally (118 min). Ingest then halted on LinkedIn's HTTP 999 (SHACL max 599); fixed — any three-digit status recorded, ≥600 = blocked. 116/116 tests. | 7aa6657 |
| 2026-09-26 | 3 | 3b: host Ollama answered 404 (model not pulled), then timed out on every call (CPU too slow). Added `--summariser remote` (OpenAI-compatible: `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`), LLM circuit breaker, LLM limits in `ENRICH_CONFIG`. 124/124 tests. | 4520101 |
| 2026-09-26 | 3 | 3b: OpenCode Zen didn't work out; trying Gemini via its OpenAI-compatible endpoint. Added `LLM_MAX_TOKENS` (thinking models), a cut-off-reply message, and `--llm-only` (no offline fallback; stop when the quota runs out). 127/127 tests. | 22471e9 |
| 2026-09-26 | 3 | 3b: Gemini answered 503 "high demand". Remote summariser now retries 429/500/502/503/504 and network errors with capped exponential backoff (5s, 10s, 20s, 40s; 4 retries) or Retry-After. 131/131 tests. | 98df377 |
| 2026-09-26 | 3 | 3b: Gemini kept answering 503, Mistral 429 "rate limit exceeded". Added provider rotation (`LLM_PROVIDERS`, peasant's key names and measured profiles): per-provider cool-down on 429/5xx, drop on 401/402/403, next provider on a bad reply. 142/142 tests. | af504f6 |
| 2026-09-26 | 3 | 3b: rotation sample 34/50 enriched (Groq answering), 13 refused, 3 failed; overnight `--only-new --llm-only --reembed` loop started. Added `docs/commands-gnamgnam.md`; `pipeline.sh` accepts `--summariser remote`. | |
| 2026-09-26 | — | Command-reference commit had landed after the merge; re-applied. | |
| 2026-09-26 | 4 | Write path (Repository + SHACL, token/session/CSRF auth, change log), links (shared graph, mentions, /r resolver, links panel, picker), /find, bookmark tags + notes. 174 core + 5 store tests; Playwright + axe; survives re-ingest. | 2672317 |
| 2026-09-26 | 4 | Local check: writes, notes, tags and links work. Phase 4 done. | |
| 2026-09-26 | 5 | Trestle: shared outline parser (fixes bookmark contexts), Workflowy import (8,118 items, 5,819 bookmark links), outliner UI with keys + touch toolbar, exports that round-trip. 190 core + 7 store tests; Playwright + axe. | e698cec |
| 2026-09-26 | 6 | Farelo: tasks, board (drag, keys, no-JS menu), Getting Things Diced (pure dice, policies, roll log, print), task pages, outline TODO import (144 tasks); outline parser treats `#` headings as items. 208 core + 9 store tests; 36k-roll distribution; Playwright + axe. | 0c96281 |
| 2026-09-26 | 7 | Wiki: pages with full revisions, `[[Title]]` create-on-follow, mentions/backlinks, preview, 409 conflict page, history + diff, find/lookup, import from foowiki Turtle or Markdown files; `/find` tolerates a failing facet; inline code no longer linked. 223 core + 10 store tests; Playwright + axe. | 67d5304 |
| 2026-09-26 | 8 | News: RSS/RDF/Atom/JSON Feed parsing, discovery, OPML/URL-list import, polite conditional-GET poller with back-off, river/item/feed pages, read/star in place, save as bookmark / make task (linked, starred), `bin/news.js`, optional server polling + pruning; fetch helpers lifted to `src/common/http/fetch.js`; `/find` + `refresh` hook. 243 core + 11 store tests; local feed server; Playwright + axe. | cf557e2 |
| 2026-09-26 | 9 | Blog: posts (drafts owner-only), drafts from wiki pages / outline items, dated URLs, tags, Atom, static export with relative links; Markdown renderer gains local-link mapping + relative hrefs; thrown 4xx keep their status. 252 core + 12 store tests; exported site browsed; Playwright + axe. | 3b32548 |
| 2026-09-26 | 10 | Squirt: search-first phone page, capture routed to task / bookmark / wiki Inbox, timeline from the change log + facet `recent()`, manifest + icons, service worker (network first, offline copies, cleared on logout), share target + bookmarklet. Chrome reports it installable; offline verified with the server stopped. 259 core + 12 store tests; Playwright + axe. | 5793270 |
| 2026-09-26 | 11 | What next? advisor: transparent weighted scoring with reasons, time/@context inputs, skip penalty, learning from accepts, related resources, close-call dice, optional LLM second opinion; on /farelo/next and Squirt. 272 core + 13 store tests; Playwright + axe. | c9cfdfd |
| 2026-09-26 | 12 | Operations: backup/restore (drill: identical counts across 17 graphs), app healthcheck + degraded /health, JSON logging, CI workflow, security review (private mode, CSP, cache headers, Secure cookie, link fix), deployment/security docs; CI workflow. 276 core + 13 store tests. | fbd08b6 |
| 2026-09-26 | 3 | Topics from keywords (`bin/topics.js`, GnamGnam Topic filter); tags across facets (`/tags`, `/tags/<tag>`); links helper and panel shared by every facet; news item views split out. 282 core tests. | 833b881 |
| 2026-09-26 | — | Review of the whole branch: fixed a malformed cookie crashing the server (uncaught before the handler's try), Done-column drag/keys placing cards the wrong way round, and a poll whose items failed to store not being recorded (feed never backed off). 284 core + 14 store tests. | 8600042 |
| 2026-09-27 | 13 | Cross-facet contact: URLs as a join key (bookmarked/feeds/site/dead-link warnings), blog mentions, bookmark source; one related vector space (Related on every detail page, News For you, advisor to-hand); topics shared across facets with hubs; project hubs + quiet-project reason; day and week views. 301 core tests; sandbox checks with a stand-in embedder; Playwright + axe. | bfedc37 |
| 2026-09-27 | 13 | Related sync: Ollama batch embedding (16 per request, falls back to one at a time), a lock so the server and `bin/related.js` never sync at once (the other picks up what was saved instead of redoing it), CLI shows the total and time left. 303 core tests. | 8e22770 |
| 2026-09-27 | 12 | Backups revisited: the related index and its state are now backed up (rebuilding took hours); `bin/restore.js --check` (checksum, parse, per-graph counts beside the live store), `--graph <name>` (restore one facet's graphs, leave the rest), `latest`; backup age on `/health`; `docs/backup.md` with restic for an encrypted off-machine copy. Drill: wiki restored alone, later task kept. 307 core tests. | 770f052 |
| 2026-09-28 | 8 | News river ordered by feed rather than date: `Date.parse` can't read timezone abbreviations (BST, CET, CEST, AEST…), so those items were undated and sorted by poll time, in feed-sized blocks. Feed dates now understand them; a later poll fills in a missing date; dates over a day ahead count as none; `poll --all --refetch` skips the conditional GET to repair existing items. 310 core + 14 store tests. | 52d6b74 |
| 2026-09-28 | 8 | Manage feeds (`/news/admin`, linked from the river; `/news/feeds` redirects): add, import, and two lists — being read, and failing ones set aside — with reread / set aside / return / delete for what is ticked, select all. Failing feeds are parked (refused or gone at once, else after 3 failures in a row), not polled by the server, `poll` or `poll --all`; a successful retry returns them. CLI `park`/`unpark`, `poll --include-failing`. 312 core + 14 store tests; 375px, axe clean light and dark. | d867912 |
| 2026-09-28 | 12 | Mobile kept showing the login page: sessions were in memory (every restart or rebuild logged devices out) and the cookie was SameSite=Strict (dropped when DIM is opened from another app). Sessions now persist in `data/sessions.json` (hashed ids, 600, void on a token change); cookie SameSite=Lax (CSRF tokens still guard writes); the login page offers **Ignore — continue read-only** when reads are public, and says why when `DIM_PRIVATE` is on. Link-button CSS de-duplicated into base.css. 314 core tests; 375px, axe clean. | f59d4e8 |
| 2026-09-28 | 3 | Bookmarks saved in DIM (Squirt capture/share, News save) are fetched (link check), summarised and embedded straight away in the background (`AutoEnricher`, via GnamGnam's `refresh` hook; same enricher as `enrich --reembed`); index written a few seconds later and on shutdown, only when changed; `ENRICH_SUMMARISER` (ollama/remote/extractive, offline fallback), `AUTO_ENRICH=0` off; the bookmark page says it's in progress; queue on `/health`. 317 core tests; sandbox: captured page enriched (HTTP 200, summary, keywords) and embedded. | 6db43f5 |
| 2026-09-28 | 8 | Feed inbox: a bookmarked web page's feeds (found as the page is fetched for enrichment, via an enricher observer wired in app.js) become suggestions in graph:facet/news (`dim:FeedSuggestion`; one per feed, every bookmark it was on; not ones already read or dismissed; no comment feeds or GitHub commit feeds), listed on Manage feeds with Subscribe (read at once; failing ones parked) / Dismiss. `bin/feed-scan.js` for existing bookmarks: polite per-site scan, head only, ≤3 pages per site stopping at the first feed, known sites skipped, resumable, `--dry-run`. Admin routes split out. 324 core tests; sandbox: capture → suggestion → subscribe; 375px, axe clean. | 9fe2a81 |
| 2026-09-28 | 13 | Search everything (`/find`, Squirt's search box; `/find.json?ranked=1`): one ranked list by meaning (related + bookmark indexes) and by words (each facet's find), both-ways hits first, filter by facet, words-only fallback when Ollama is down; the link picker keeps the fast words-only `/find.json`. The related index now takes every kept news item (not a month), every task, and outline items from 12 characters. 326 core tests; 375px, axe clean. | 96a1af6 |
| 2026-09-28 | 13 | Shared bookmark index: `VectorIndex` records this process's changes since it last read or wrote the file; `save()` takes a short lock (stale by age, so it works across containers), reloads and re-applies them if another process saved in between, and writes whole files (temp + rename). The server reloads the index and bookmark texts within a minute of a tool's save. So the server's auto-enrich and `enrich --reembed` / `ingest` no longer overwrite each other, and no restart is needed after them. 329 core tests; live: a server and a tool saving the same index kept both's vectors. | b21370f |
| 2026-09-28 | 3 | `enrich` stopped mid-run ("Detected unsettled top-level await" after 402/4720): a fetch stalled without failing, and request timeouts don't keep Node alive, so the process just ended. Each bookmark now has a deadline (`ENRICH_CONFIG.bookmarkDeadlineMs`, 5 min) on a timer that does; a stuck one is reported failed (timed out) and the run carries on. Also protects the server's auto-enrich queue. 330 core tests; reproduced with a never-settling fetch. | 208157d |
| 2026-09-30 | 10 | Squirt offline: the 10 newest news summaries kept in localStorage, offline notes on them and offline capture queued on the device and synced in order when back online; cleared on logout (`offline.js`, `offlineQueue.js`). Core tests + lint; not yet checked in a real browser. | uncommitted |
