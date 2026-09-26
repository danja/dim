# Trestle — Commands and use

The outliner facet: outlines of items with Markdown titles and notes, after
[danja/trestle](https://github.com/danja/trestle). Data lives in
`graph:facet/trestle`; links from items to bookmarks and other things in
`graph:facet/links`. Background: `docs/tools.md`, `docs/plan-detail.md` (Phase 5).

## Import the Workflowy outline

```sh
node bin/trestle-import.js                      # data/workflowy.md → outline "workflowy"
node bin/trestle-import.js --replace            # delete that outline and import again
node bin/trestle-import.js --file notes.md --slug notes --title "Notes"
```

- Every bullet becomes an item; wrapped link titles are joined; items with
  children start collapsed.
- Items that link to a bookmark already in the store get a `resource` link
  to it: the bookmark is one click away (⌗) in the outline, and the
  bookmark's page shows the item under **Used by**.
- It refuses to touch an existing outline without `--replace` — which
  **loses any edits made to that outline in the web UI**.
- Restart the server afterwards (outlines are cached in memory).
- Run `node bin/ingest.js` first if you want the bookmark links.
- `--replace` makes new items, so links *to* the old ones (bookmark notes'
  mentions, Farelo tasks) are dropped; `node bin/farelo-import.js` relinks
  the tasks.

## In the browser

`/trestle/` lists outlines. Reading needs no login; editing needs
`DIM_WRITE_TOKEN` (see `docs/commands-gnamgnam.md`) and **log in**.

| | |
|---|---|
| **•** bullet | zoom into an item (its page: breadcrumbs, note, children, links) |
| **▸ / ▾** | expand / collapse |
| **⌗** | the bookmark the item links to |
| **¶** | the item has a note |

Logged in, click a title to edit it:

| Key | |
|---|---|
| Enter | save, new item below |
| Tab / Shift+Tab | indent / outdent |
| ↑ / ↓ | previous / next item |
| Alt+↑ / Alt+↓ | move the item up / down |
| Backspace (empty item) | delete it |
| Esc | stop editing |

On a phone the same actions sit in a toolbar at the bottom while editing.
Without JavaScript, every item's page has forms for all of it (move, edit
title and note, add, delete).

Notes are Markdown; `[[bookmark/slug]]`, `[[Some title]]` or a pasted DIM
URL in a note become **Mentions** links.

## URLs

| URL | |
|---|---|
| `/trestle/` | outlines |
| `/trestle/outline/<slug>` | an outline (`.md` Markdown, `.ttl` Turtle) |
| `/trestle/node/<id>` | one item zoomed in (`.md` subtree, `.json`) |
| `POST /trestle/outlines` | `title` |
| `POST /trestle/nodes` | `outline` (slug) or `parent` (id) or `after` (id), `title` |
| `POST /trestle/node/<id>` | any of `title`, `note`, `collapsed` |
| `POST /trestle/node/<id>/move` | `op` = `indent` \| `outdent` \| `up` \| `down` |
| `POST /trestle/node/<id>/delete` | the item and everything under it |

Writes take a form (with the page's CSRF token) or JSON with
`Authorization: Bearer $DIM_WRITE_TOKEN`.

The Markdown export round-trips: exporting the imported Workflowy outline
and parsing it again gives the same 8,118 items. Notes are not in the
Markdown export; the Turtle export has everything.
