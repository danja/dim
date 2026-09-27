# Farelo — Commands and use

Tasks on a Kanban board, and **Getting Things Diced** to pick what to do
next (Danny Ayers, 2015 — the method is summarised in `docs/plan-detail.md`,
6.1). Tasks live in `graph:facet/farelo`; their links (to bookmarks,
outline items, anything) in `graph:facet/links`.

## Seed tasks from the outline

```sh
node bin/farelo-import.js --dry-run         # what it would add
node bin/farelo-import.js                   # add them, in Backlog
node bin/farelo-import.js --status todo     # …or straight into To do
node bin/farelo-import.js --outline notes   # another Trestle outline
```

- Items under a **TODO** heading ("TODO", "**TODO**", "Misc TODO",
  "ToDo list", "TODO 2013-11-27") become tasks; an item with children
  becomes a project, its children the project's tasks. Items that are only
  a link are skipped.
- Each task links to its outline item (one click to the context; the item
  shows the task under **Used by**).
- Re-running adds only what is new: items already linked are skipped, and a
  to-do with the same title as an existing task is linked to it rather
  than duplicated (so it is safe after `trestle-import --replace`).
- Restart the server afterwards (tasks are cached in memory).

## The board — `/farelo/`

Columns: **Backlog · To do · Doing · Blocked · Done**. On a phone one
column shows at a time — swipe, or tap the column names.

Logged in (see `DIM_WRITE_TOKEN` in `docs/commands-gnamgnam.md`):

- add a task at the top (column and priority);
- **drag** a card by its ⠿ grip to another column or place;
- or focus a card (Tab) and use **Alt+←/→** (column) and **Alt+↑/↓** (order);
- or open **Move** on the card (works without JavaScript).

A task that waits on another (⏳) can't go to Doing or Done until that one
is done. **All projects** filters the board to one project.

## A task — `/farelo/task/<id>`

State buttons, priority (P1 highest … P5 lowest), due date, estimate,
contexts/tags, project, **waits on** (dependencies), a Markdown note
(`[[task/…]]`, `[[bookmark/…]]`, `[[Title]]` become links), the links panel
(resources one click away), and its history from the change log.

## Getting Things Diced — `/farelo/dice`

The eligible tasks — **To do** or **Doing**, not a project, not waiting on
anything — in priority order (then due date, then age); the top eleven get
the numbers 7, 6, 8, 5, 9, 4, 10, 3, 11, 2, 12, so priority 1 comes up one
roll in six. **Roll**, then **Start it** (moves it to Doing). For the next
roll choose:

- **Replace** — the picked task leaves the list, the next one moves up;
- **Skip** — keep the list, ignore that number;
- **New list** — start again.

A roll that hits an empty number rolls again. Every roll is recorded
(`graph:system/rolls`) for the "what next?" advisor to learn from later.
**Print the list** gives the paper version.

## URLs

| URL | |
|---|---|
| `/farelo/` | board (`?project=<id>`, `?done=all`) |
| `/farelo/task/<id>` | a task (`.json`) |
| `/farelo/dice` | the numbered list |
| `POST /farelo/tasks` | `title`, `status`, `priority`, `project`, … |
| `POST /farelo/task/<id>` | any of `title`, `note`, `priority`, `due`, `estimate`, `tags`, `project`, `isProject`, `dependsOn` |
| `POST /farelo/task/<id>/move` | `status`, and optionally `before` / `after` (a task id) |
| `POST /farelo/task/<id>/delete` | |
| `POST /farelo/dice` | `policy` = `replace` \| `skip` \| `new`, plus the round's `exclude`, `skip`, `lastTask`, `lastTarget`; JSON gives `{ picked, state }` |

**Note:** `node bin/trestle-import.js --replace` recreates the outline's
items, which drops links *to* them — including tasks' links to their
outline items. Run `node bin/farelo-import.js` afterwards to relink.

## Projects as hubs

A project's page (any task marked *This is a project*, or with tasks in it)
gathers the project in one place:

- **Progress:** how many of its tasks are done, and when anything last
  happened.
- **Contains:** everything linked as *part of* it, grouped by facet: wiki
  pages, outline items, bookmarks, feeds, posts. Link them from their own
  page's **Links** panel (kind *part of*, pick the project), or from the
  **Add** box on the project page.
- **Used by its tasks:** the resources its tasks link to.

## What next? (`/farelo/next`)

The advisor ranks the tasks that are ready (To do or Doing, not projects,
nothing they wait on unfinished) and says why. It's also linked from the
board and shown as **Next up** on Squirt.

- **Tell it your situation:** how much time you have (15 min … 2 h) and
  where you are. Where you are is any `@tag` on your tasks, e.g. `@desk`,
  `@bench`, `@town`. Both are optional.
- **Each suggestion shows its reasons** with points, e.g. `+3.0 priority 1`,
  `+2.6 due in 2 days`, `−2.0 needs ~90 min, more than 30`. The score is
  their sum:

| Reason | Adds when | Default weight |
|---|---|---|
| Priority | priority 1 → full, 5 → a fifth | 3 |
| Due soon | overdue or due today → full, fading to nothing two weeks out | 3 |
| Under way | it's in Doing — finish what you started | 1.5 |
| Fits your time | its estimate fits (takes away when it doesn't) | 2 |
| Your context | it has your `@tag` (takes away if tagged for somewhere else) | 1 |
| Unblocks others | other tasks wait on it (full at 3) | 1.5 |
| Resources ready | it links to bookmarks, pages, … | 0.5 |
| Waiting long | it has waited up to 60 days | 0.5 |
| Skipped lately | you said "Not now" (takes away, fading over ~3 days) | 2 |
| Quiet project | its project has seen no activity for two weeks (full at six) | 1 |

- **Do this now:** moves the task to Doing and opens it. Picking something
  lower in the list teaches the advisor: the weights move a little toward
  the reasons where your choice beat the ones above it. **How suggestions
  are scored** shows the current weights and resets them.
- **Not now:** pushes that task down for a few days.
- **Related:** the top suggestion lists what's to hand. That is its links,
  plus things in other facets whose names share most of the task's topic
  words.
- **Close calls:** when the top two are within 5%, the page offers the dice.
- **Ask an LLM to talk it through:** sends the top five titles and their
  reasons to the LLM configured for enrichment (`LLM_PROVIDERS` or
  `LLM_BASE_URL`; see `docs/commands-gnamgnam.md`). It is a second opinion
  only; the order stays DIM's.

Feedback and weights live in `graph:facet/advisor`.
