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
| 1 | Restructure into `common` + `gnamgnam` | 0 | `[ ]` |
| 2 | Shared shell: facet registry, tabs, mobile-first UI kit | 1 | `[ ]` |
| 3 | GnamGnam completion (live probe, enrichment, full index) | 1 (2 for UI) | `[ ]` |
| 4 | Write path & cross-linking foundation | 2 | `[ ]` |
| 5 | Trestle outliner | 4 | `[ ]` |
| 6 | Farelo (Kanban + Getting Things Diced) | 4 | `[ ]` |
| 7 | Wiki (from foowiki) | 4 | `[ ]` |
| 8 | Newsmonitor (RSS) | 4 | `[ ]` |
| 9 | Blog engine | 7 | `[ ]` |
| 10 | Squirt — mobile view of everything | 5–9 (incrementally) | `[ ]` |
| 11 | "What next?" advisor | 6, 3, 4 | `[ ]` |
| 12 | Operations: backup, auth, deploy hardening | runs alongside | `[ ]` |

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

- [ ] Run `npm test` and record the baseline (count, pass/fail) in the log.
- [ ] Create `src/common/` and `src/gnamgnam/`; `git mv` files per 1.1 so
      history follows.
- [ ] Update all imports in `src/`, `bin/`, `tests/`, `config/`.
- [ ] Make `SearchService` / `LexicalIndex` generic: take a document
      adapter `{ textView query, compose(doc), facets }` instead of
      hard-wiring bookmarks. GnamGnam supplies the bookmark adapter.
- [ ] Split `src/api/server.js` (243 lines) into
      `src/common/http/{router,negotiate,respond}.js` and
      `src/gnamgnam/routes.js` + `src/gnamgnam/pages/search.js`.
- [ ] Refactor other files over ~200 lines (C6):
      `enrich/Summarisers.js` (248), `vectors/VectorIndex.js` (233),
      `enrich/Fetchers.js` (216) — one class per file where natural.
- [ ] Move `tests/` to mirror the new layout (`tests/common/…`,
      `tests/gnamgnam/…`).
- [ ] `bin/*` scripts: keep names/flags stable (docs/tools.md is the contract);
      they just import from new paths. Consider `bin/gnamgnam/` later only
      if the bin dir gets crowded.
- [ ] Add `graph:facet/*` kind to `GRAPH_KINDS`.
- [ ] Update `README.md`, `docs/tools.md`, `docs/enricher.md` paths.

### Acceptance

- `npm test` passes with the same number of tests as the baseline (plus any new).
- `node bin/serve.js` serves the same search results for 3 recorded
  queries as before the move (record queries + top-5 IRIs in the log).
- No file in `src/` over ~200 lines, or a note here saying why not.

---

## Phase 2 — Shared shell: facet registry, tabs, UI kit

**Goal:** one server hosts every facet; each facet has a mobile-first page
with the tab row on top.

### 2.1 Facet contract

Each facet exports from `src/<facet>/index.js`:

```js
export default {
  id: 'gnamgnam',            // path segment and graph suffix
  label: 'GnamGnam',          // tab text
  graphs: ['graph:source/workflowy'],
  vocab: 'vocabs/gnamgnam.ttl',        // optional
  shapes: 'vocabs/shapes/gnamgnam.ttl',// optional
  routes (router, ctx) { … },          // registers /gnamgnam/...
  searchAdapter,                       // optional: feeds common search
  async init (ctx) { … }               // optional: load indexes etc.
}
```

`src/facets.js` lists facets explicitly, in tab order (no autoload, same
rule as `enrich/registry.js`).

### 2.2 Tasks

- [ ] `src/common/http/Router.js` — tiny path router on `node:http`
      (method + pattern → handler), with content negotiation reused.
- [ ] `src/common/facets/FacetRegistry.js` — loads `src/facets.js`, calls
      `init`, mounts `routes`, exposes the tab list.
- [ ] `src/common/ui/`:
  - [ ] `layout.js` — HTML shell: `<head>`, viewport meta, CSS link,
        tab row (`<nav>` with `aria-current` on the active facet), `<main>`.
  - [ ] `public/css/base.css` — CSS custom properties (colour tokens,
        light/dark via `prefers-color-scheme`), fluid type, mobile-first
        layout, tab row that scrolls horizontally on narrow screens.
  - [ ] `public/js/` — small ESM modules (progressive enhancement only;
        pages work without JS where feasible).
  - [ ] Static file serving for `/static/*` with cache headers.
- [ ] `/` redirects to the default facet (config), each facet at `/<id>/`.
- [ ] Port GnamGnam search page onto the shell.
- [ ] `bin/serve.js` boots via `FacetRegistry`.
- [ ] Tests: router matching, negotiation, layout renders one tab per
      facet with the right `aria-current`.

### Acceptance

- On a 375px-wide viewport (Playwright screenshot), GnamGnam search is
  usable and the tab row is visible; stub tabs exist for all planned facets.
- Lighthouse/axe basic accessibility: no critical issues on the shell.

---

## Phase 3 — GnamGnam completion

**Goal:** finish the Phase 0 leftovers so bookmarks are genuinely
useful: real titles, summaries, complete vectors.

### Tasks

- [ ] Run `bin/retrieve.js --live` over the full set (1s pacing ≈ 1.5h);
      record status distribution (2xx/3xx/4xx/5xx/timeouts) in the log.
- [ ] Re-ingest with live data; titles/descriptions populated.
- [ ] Enricher: `--limit 50` sample → manual review (manual gate from
      docs/enricher.md) → full run with `--summariser ollama` + `--reembed`.
- [ ] Vector index complete (`index.size` == bookmark count, minus logged
      embed timeouts).
- [ ] Re-evaluate `minSimilarity` (currently 0.58) once summaries exist;
      record the nonsense-query score used to justify the new value.
- [ ] Richer SKOS cataloguing: auxiliary info per type (github: owner,
      repo, stars/language if cheap; arxiv: id, authors, categories;
      wikipedia: language, article title). Terms in `vocabs/gnamgnam.ttl`,
      shapes updated.
- [ ] Topic concepts: cluster or LLM-tag bookmarks into a
      `dim:bookmark-topics` SKOS scheme (`skos:broader` hierarchy); expose as
      a facet filter.
- [ ] Dead-link handling: flag 404/410 bookmarks, optional Wayback lookup.
- [ ] Bookmark detail page (`/gnamgnam/bookmark/<slug>`) shows summary,
      type, topics, context from the outline, and inbound cross-links
      (after Phase 4).

### Acceptance

- ≥ 90% of reachable bookmarks have `dim:summary`.
- 10 hand-picked queries: relevant result in top 5 for ≥ 8 (record them).
- `bin/validate.js` clean on all graphs.

---

## Phase 4 — Write path & cross-linking foundation

**Goal:** facets can create/edit data safely, and anything can link to
anything.

### 4.1 Write path

- [ ] `src/common/store/Repository.js` — typed CRUD over a facet graph:
      build `INSERT DATA` / `DELETE/INSERT WHERE` via `SPARQLHelper`,
      SHACL-validate the changed resource before commit.
- [ ] HTTP: `POST`/`PUT`/`PATCH`/`DELETE` routes per facet; forms work
      without JS (POST + redirect), JSON for JS clients.
- [ ] Auth for writes (localhost first): single-user token or HTTP Basic
      from `.env`; reads stay open on loopback. CSRF token on forms.
- [ ] Change log: every write adds `prov:Activity` (who/when/what) to
      `graph:system/changes`.

### 4.2 Cross-linking

- [ ] Shared link vocabulary in `vocabs/dim.ttl`: `dim:relatedTo`
      (symmetric), `dim:resource` (task/note → bookmark/feed item/page),
      `dim:mentions` (parsed from Markdown), `dim:partOf`.
- [ ] Links stored in `graph:facet/links` (or in the owning facet graph —
      decide and record here).
- [ ] Markdown link parser: `[[wiki-style]]` and plain IRIs to DIM
      resources become `dim:mentions` triples on save.
- [ ] Generic resolver `/r/<type>/<slug>` → owning facet's page;
      content-negotiated Turtle/JSON-LD for every resource.
- [ ] "Linked from" panel component in `src/common/ui/` used by every
      detail page.
- [ ] Cross-facet search: `SearchService` queries all registered
      adapters, results grouped by facet.
- [ ] Link picker UI: type-ahead over cross-facet search to attach a
      resource to anything.

### Acceptance

- Create, edit, delete a resource through the UI; SHACL rejects an
  invalid one with a readable error.
- A link added in one facet appears in the other's "Linked from" panel.
- Store tests cover Repository round-trip.

---

## Phase 5 — Trestle outliner

**Source:** `~/github/trestle` (danja/trestle). **Graph:** `graph:facet/trestle`.

### Tasks

- [ ] Review trestle: data model, UI interactions, storage; record which
      parts port and which are replaced by `src/common`.
- [ ] Model: `dim:Outline`, `dim:OutlineNode` with `dim:partOf` parent,
      ordering (`dim:position` or `rdf:List` — decide, record why),
      Markdown `dim:content`, collapsed state.
- [ ] Import `data/workflowy.md` as an outline, linking nodes to the
      bookmarks already harvested from it (`dim:resource`), using
      `dim:sourceLine` to join.
- [ ] Outliner UI: keyboard (Tab/Shift-Tab indent, Enter new node, arrows
      move, Alt-arrows reorder), touch equivalents for mobile, zoom into
      node, breadcrumbs.
- [ ] Autosave through the Phase 4 write path (debounced PATCH).
- [ ] Export outline as Markdown and Turtle.
- [ ] Tests: tree ↔ triples round-trip, reorder/indent operations.

### Acceptance

- Workflowy outline browsable with bookmarks one click away.
- Edit → reload → edits persist; export round-trips.

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

- [ ] Model: `dim:Task` (title, Markdown notes, status as SKOS concept in
      `dim:task-states`: backlog/todo/doing/blocked/done), `dim:dependsOn`,
      `dim:partOf` (projects = tasks with children), estimate, due,
      priority, contexts (SKOS), `dim:resource` links.
- [ ] Kanban board UI: columns = states, drag/drop (pointer events,
      keyboard fallback), swimlanes by project, mobile: one column at a
      time with swipe/tab switch.
- [ ] "Dice" mode implementing 6.1 in `src/farelo/dice.js`
      (pure functions, no I/O):
  - [ ] `diceList(tasks)` — the eligible tasks (not blocked, dependencies
        met, not done), sorted by priority; the top 11 get priorities 1–11
        and targets from the table. Ties are broken by due date, then age.
  - [ ] `roll(rng)` → 2d6 sum; `pick(list, rng)` re-rolls on empty or
        excluded targets. Injectable RNG so tests can use a seed.
  - [ ] After-pick policies (user choice, remembered per board): *replace*
        (refill the slot from the next unnumbered task), *skip target*
        (exclude it for the next roll), *new list* (recompute).
  - [ ] UI: a "Roll" button that animates two dice, shows the sum, target
        and chosen task, plus the probability table for the current list.
        Printable list view (the post's own "nice printable version" todo).
  - [ ] Record each roll as a `prov:Activity` (sum, chosen task, policy)
        so Phase 11 can learn from accept/skip.
- [ ] Task detail page: resources one click away, "Linked from" panel,
      history from change log.
- [ ] Import: seed tasks from Trestle nodes tagged TODO / checkbox items.
- [ ] Tests: state transitions, dependency eligibility; dice: target table
      matches 6.1, the distribution over 36k seeded rolls is within 1% of
      the P(target) row, the <11-task re-roll, and each after-pick policy.

### Acceptance

- Board usable on phone and desktop; moving a card persists.
- Dice pick never returns a blocked or dependency-pending task.
- Pick frequencies match the 2d6 distribution for the priority table in 6.1.

---

## Phase 7 — Wiki (from foowiki)

**Source:** `~/github/foowiki` (danja/foowiki). **Graph:** `graph:facet/wiki`.

### Tasks

- [ ] Review foowiki; record what ports.
- [ ] Model: `dim:Page` with Markdown body (`dim:content`), title, slug,
      revisions (`prov:wasRevisionOf`), tags as SKOS.
- [ ] Markdown rendering with `marked` (already a dependency), sanitised
      output; `[[Page]]` links, create-on-follow for missing pages.
- [ ] Edit UI: textarea + preview (JS-enhanced), conflict detection via
      revision id.
- [ ] Mentions → `dim:mentions` cross-links (Phase 4 parser).
- [ ] Page history and diff view.
- [ ] Wiki pages indexed in cross-facet search (adapter).
- [ ] Tests: link parsing, render sanitisation, revision chain.

### Acceptance

- Create/edit/link pages; backlinks shown; history viewable.

---

## Phase 8 — Newsmonitor (RSS)

**Source:** `~/github/NewsMonitor` (danja/NewsMonitor). **Graph:**
`graph:facet/news` (feeds) + `graph:source/feed/<slug>` per feed if
licences differ.

### Tasks

- [ ] Review NewsMonitor; record what ports.
- [ ] Model: `dim:Feed`, `dim:FeedItem` (title, link, published,
      summary, read/starred state).
- [ ] Fetcher: RSS/Atom/JSON Feed parsing, conditional GET
      (ETag/Last-Modified), polite scheduling, reuse `src/common` HTTP
      fetch helpers (lifted from `enrich/Fetchers.js`).
- [ ] Scheduler: `bin/news.js` for one-shot + a lightweight interval in the
      app container (or cron in compose).
- [ ] Reader UI: unread list, per-feed view, mark read, "save as
      bookmark" (→ GnamGnam), "make task" (→ Farelo).
- [ ] OPML import/export.
- [ ] Items embedded and searchable; optional summarisation via enricher.
- [ ] Retention policy for old items.
- [ ] Tests: feed parsing fixtures, dedupe by GUID/link.

### Acceptance

- 20+ feeds polling reliably; unread counts correct; one-click
  bookmark/task creation works.

---

## Phase 9 — Blog engine

**Graph:** `graph:facet/blog`. Depends on Wiki (Markdown pipeline).

### Tasks

- [ ] Model: `dim:Post` (Markdown, title, slug, published date, draft
      flag, tags), reuse wiki rendering.
- [ ] Authoring: promote a wiki page or outline node to a draft post.
- [ ] Public views: index, post page, tag pages, Atom feed.
- [ ] Static export (`bin/blog-export.js`) to a directory for hosting
      elsewhere — keeps the app itself localhost-only.
- [ ] Tests: slug/date routing, feed validity, draft exclusion.

### Acceptance

- Drafts invisible publicly; export produces a valid static site + feed.

---

## Phase 10 — Squirt: mobile view of everything

**Source:** `~/github/squirt` (danja/squirt).

### Tasks

- [ ] Review squirt; record what ports.
- [ ] Unified timeline/inbox: recent items across facets (new feed items,
      tasks due, recently edited pages/nodes, new bookmarks).
- [ ] Quick capture: one input that creates a bookmark (URL), task
      (`todo …`), note, depending on content — the "squirt" in.
- [ ] Web App Manifest + service worker for installability and offline
      read of recent items; share-target to capture from phone share sheet.
- [ ] Cross-facet search as the primary control.

### Acceptance

- Installable on a phone; capture from share sheet lands in the right facet.

---

## Phase 11 — "What next?" advisor

**Goal:** the system tells me what to do next to make best use of my
time/resources.

### Tasks

- [ ] Define inputs: eligible tasks (Farelo), due dates, estimates,
      priority, context (time available, device, location), recency of
      work, linked resources' readiness.
- [ ] Scoring v1: transparent weighted formula, every suggestion shows
      its reasons. Dice mode (Phase 6) as the tie-breaker.
- [ ] Surface related resources for the chosen task via cross-links +
      semantic search (bookmarks, pages, feed items).
- [ ] Optional LLM pass (Ollama) to explain/rank the top N — advisory only.
- [ ] Feedback: accept/skip recorded to tune weights.
- [ ] Shown on Squirt home and Farelo.

### Acceptance

- Given a seeded fixture graph, suggestions are deterministic and
  explainable; skip feedback changes later ordering.

---

## Phase 12 — Operations (ongoing)

- [ ] Backups: scheduled Fuseki dump (TriG) + FAISS index + `data/cache`
      to a host directory; restore drill documented.
- [ ] Healthchecks for all compose services; `/health` reports per facet.
- [ ] Structured logging (loglevel → JSON option).
- [ ] CI: GitHub Actions running `npm test` (core, offline) on push.
- [ ] Security review before anything leaves loopback (write auth,
      Fuseki update endpoint never exposed).
- [ ] Keep `docs/tools.md` and `docs/deployment.md` in step with each phase.

---

## Open questions

| # | Question | Raised | Decision |
|---|---|---|---|
| Q1 | Links in a shared `graph:facet/links` or in the owning facet's graph? | Phase 4 | |
| Q2 | Outline ordering: `dim:position` numbers or `rdf:List`? | Phase 5 | |
| Q3 | Source repos (trestle, NewsMonitor, foowiki, squirt) are not in this sandbox — add them to the session / vendor snapshots when those phases start. | 2026-09-26 | |
| Q4 | Getting Things Diced method — needs a local copy of the post. | 2026-09-26 | Resolved: copy in `docs/`, method in 6.1. |
| Q5 | Write auth model for localhost: token vs Basic vs none-on-loopback. | Phase 4 | |

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
