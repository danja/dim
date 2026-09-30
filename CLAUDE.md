# CLAUDE.md

DIM (Danny's Information Manager): one personal web app over a SPARQL store
(Fuseki) and a vector index (FAISS, embeddings from Ollama). Seven facets
share one shell with tabs: bookmarks, outliner, tasks, wiki, news, blog,
and a phone/PWA view. The plan and a dated work log with commit refs are in
`docs/plan-detail.md`.

* Periodically read INBOX.md and insert as actionable tasks into TODO.md
* When asked to work onthe project, review TODO.md to determine the next task


## Commands

```sh
npm test                      # core tests: offline, fast; run before every commit
npm run test:store            # store tests: need Fuseki (and SPARQL_* env)
npx standard <files>          # lint (StandardJS); a few errors predate you, don't add new ones
node bin/serve.js             # app on :4110 (PORT); needs Fuseki + OLLAMA_URL
docker compose up -d fuseki ollama   # services, on loopback only
docker compose up -d --build app     # the app in Docker (data in the app-data volume, not ./data)
```

Other tools in `bin/`: each has its usage at the top and a
`docs/commands-<facet>.md` page (ingest/retrieve/enrich, trestle-import,
farelo-import, wiki-import, news, feed-scan, blog-export, topics, related,
backup/restore, deadlinks, validate).

## Layout

| Path | What |
|---|---|
| `src/<facet>/` | gnamgnam (bookmarks), trestle (outliner), farelo (tasks + dice), wiki, news, blog, squirt (PWA); advisor ("What next?") |
| `src/<facet>/index.js` | `create<Facet>Facet()`: the facet object (contract in `src/common/facets/FacetRegistry.js`) |
| `src/<facet>/api/` | routes and page renderers (template strings, no framework) |
| `src/common/` | store, http, ui, links, related, topics, journal, ops (backup), vectors, embeddings |
| `src/facets.js` | the facets, in tab order: an explicit list, no autoloading |
| `src/app.js` | `buildApp()`: wiring shared by `bin/serve.js` and the tools |
| `sparql/queries/<category>/<name>.sparql` | every SPARQL query; loaded by `QueryService.get('cat/name', params)` |
| `vocabs/dim.ttl`, `vocabs/shapes.ttl` | vocabulary and SHACL shapes |
| `config/config.json`, `config/preferences.js` | settings (`${ENV}` placeholders) and tunables (`NEWS_CONFIG`, …) |
| `tests/<facet>/`, `tests/store/` | Vitest; `tests/store` is the live-store suite |

## Rules

- **Stack:** vanilla HTML, CSS and ES modules. No framework, no bundler,
  no client-side build. Pages must work without JS; JS only enhances
  (`src/common/ui/public/js/`).
- **Split files over ~200 lines.** Keep modules small and single-purpose.
- **Data is RDF, content is Markdown.** Every triple lives in a registered
  named graph (`GraphRegistry`: kind, licence, provenance). Facet data goes
  in `graph:facet/<facet>`, cross-links in `graph:facet/links`, third-party
  text in `graph:source/*`, the change log in `graph:system/changes`.
- **IRIs:** `http://purl.org/stuff/dim/<type>/<slug>` (`dim:`). New
  properties go in `vocabs/dim.ttl`, and any constraints in
  `vocabs/shapes.ttl`.
- **No inline SPARQL** in JS. Put it in `sparql/queries/`. Placeholders
  are `${name}`, all required. Prefixes come from `NamespaceManager`; a
  test fails on unknown prefixes, including in comments, so write IRIs
  like `<graph:facet/x>` there.
- **User writes** go through `Repository` (SHACL-validated, change-logged)
  and `writeRoute()` (session + CSRF, or a Bearer token). Reads are public
  unless `DIM_PRIVATE=1`; writes need `DIM_WRITE_TOKEN`. Machine state
  (poll status and the like) may use direct updates, as `news/writes.js`
  does.
- **Forms:** `formFields(session, returnPath)`. A non-empty `_return`
  overrides the route's redirect, so pass `''` when the route redirects
  somewhere itself, e.g. with a `?notice=`.
- **Cross-facet features** use the optional facet hooks (`lookup`, `find`,
  `documents`, `day`, `tags`, `aboutDomain`, `urlStatus`, …), never
  imports between facets.
- **UI:** mobile-first. Check at 375px with no horizontal scroll, 44px tap
  targets, light and dark themes, and axe clean. The CSP is strict
  (`script-src 'self'`, no inline scripts or styles).
- **Config:** no silent defaults; a missing required value is an error.
  Secrets go in `.env` and never in git or backups.
- **Derived data** (`data/*.index`, `data/related.*`, `data/cache/`) is
  rebuildable but slow: embedding everything takes hours on a CPU. It's
  backed up by `bin/backup.js`.
- **Login sessions** persist in `data/sessions.json` (hashed ids, mode 600,
  dropped when the token changes). It isn't backed up.

## Testing notes

- Core tests use in-memory stand-ins (e.g. `tests/news/memoryNews.js`,
  `tests/wiki/memoryWiki.js`, fake fetch tables) and never touch the network.
- Route tests start `createServer()` on port 0 and call it with
  `Authorization: Bearer <token>` plus JSON. Pages are checked by their HTML text.
- For UI changes, also check the page in a real browser: Playwright with
  Chromium, a 375px viewport, and axe (`bypassCSP: true` to inject it).

## Working in this repo

- Add a line to the work log in `docs/plan-detail.md` for each meaningful
  step: date · phase · what · commit ref. Update the matching
  `docs/commands-*.md` page when behaviour or CLI flags change.
- Commit messages: a summary line, then what changed and why.
- The server caches facet data in memory. After a CLI tool writes to the
  store, restart the server (or use the web UI). Exception: the bookmark
  index (`VectorIndex`) merges saves from several processes under a lock and
  the server reloads it (and the bookmark texts) within a minute.
