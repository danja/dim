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
