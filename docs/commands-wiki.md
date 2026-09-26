# Wiki — Commands and use

Markdown pages with full history, after
[danja/foowiki](https://github.com/danja/foowiki). Pages and every revision
live in `graph:facet/wiki`; links to and from other things in
`graph:facet/links`. Background: `docs/tools.md`, `docs/plan-detail.md`
(Phase 7).

## Import

```sh
node bin/wiki-import.js --turtle foowiki-dump.ttl --dry-run   # list what would change
node bin/wiki-import.js --turtle foowiki-dump.ttl             # a foowiki store dump
node bin/wiki-import.js --dir ~/notes                         # every *.md file in a folder
```

- **foowiki:** anything with a title (`dc:title`/`rdfs:label`) and
  `sioc:content` becomes a page; tags from `…tag`/`…subject`/`…topic`
  literals; the earliest date is kept as the creation time. Dump the
  foowiki store with, for example:
  `curl -s -H 'Accept: text/turtle' 'http://localhost:3030/foowiki/data?default' > foowiki-dump.ttl`
  (adjust to where your foowiki data lives).
- **Markdown files:** the title comes from front matter (`title:`,
  `tags:`), else the first `# heading`, else the file name.
- Links between imported pages — foowiki's `[text](Page Title)`, a file's
  `[text](other.md)` — become wiki links, and are recorded as mentions.
- A page whose title already exists gets a new revision, only if its text
  changed: re-running an import is safe, and web edits stay in the history.
- Restart the server afterwards (pages are cached in memory).

## In the browser

`/wiki/` lists pages, recent changes and tags. Reading needs no login;
editing needs `DIM_WRITE_TOKEN` (see `docs/commands-gnamgnam.md`) and **log in**.

| In a page's text | Links to |
|---|---|
| `[[Page title]]` | that wiki page — shown dashed red if it doesn't exist yet; follow it to create it |
| `[[bookmark/slug]]`, `[[task/…]]`, … | any DIM resource |
| `[text](https://…)` | the web |

Every `[[…]]` becomes a **Mentions** link; the page mentioned lists it
under **Mentioned by**. Creating a page links the `[[Title]]`s that were
already waiting for it. `[[…]]` inside code is left alone.

- **Edit** → change title, text, tags → **Preview** (nothing saved) or **Save**.
- If the page was saved by someone else (another tab) since you started
  editing, Save shows **Edit conflict**: your text is kept, what the other
  save changed is shown, and saving again replaces it.
- **history** (page foot) → every revision; **changes** shows a line diff.
- Renaming a page keeps its address; `[[New title]]` finds it by title.

| URL | |
|---|---|
| `/wiki/` · `/wiki/?tag=…` | index, by tag |
| `/wiki/page/<slug>` | a page (`.md` text, `.ttl` page + revisions, `.json`) |
| `/wiki/page/<slug>/edit` | edit (or create) |
| `/wiki/page/<slug>/history` | revisions |
| `/wiki/page/<slug>/r/<n>` | one revision's text |
| `/wiki/page/<slug>/diff?from=1&to=3` | changes between two revisions |
| `/wiki/new?title=…` | open or start the page of that title |
| `/r/page/<slug>` | the resolver's address for a page |

## From a script

```sh
( set -a; . ./.env; set +a
  curl -s -X POST localhost:4110/wiki/page/my-page -H "Authorization: Bearer $DIM_WRITE_TOKEN" \
    -H 'Content-Type: application/json' -H 'Accept: application/json' \
    -d '{"title":"My Page","content":"See [[Home]].","tags":"notes","base":0}' )
```

`base` is the revision the edit starts from (0 for a new page); a stale
`base` answers 409 with the current revision. Add `"action":"preview"` to
get the rendered HTML without saving. `POST /wiki/page/<slug>/delete`
removes a page, its history and its links.
