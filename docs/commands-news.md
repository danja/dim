# News — Commands and use

The feed reader, after [danja/NewsMonitor](https://github.com/danja/NewsMonitor).
It reads RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed. Subscriptions, poll status
and your read/starred flags live in `graph:facet/news`. Items are third-party
text, so they live in `graph:source/news` (licence `proprietary-linkout`:
link out, never redistributed) and expire. Background: `docs/tools.md`,
`docs/plan-detail.md` (Phase 8).

## Subscribe

```sh
node bin/news.js add https://example.org/                # a site: its feed is found for you
node bin/news.js add https://example.org/feed.xml --tags synth,diy
node bin/news.js import feeds.opml                        # OPML (folders become tags)
node bin/news.js import ~/github/NewsMonitor/src/main/resources/feedlists/feedlist-2023.txt   # one URL per line
node bin/news.js export > feeds.opml
node bin/news.js list                                     # status, unread/total, slug, title
node bin/news.js remove <slug>                            # unsubscribe; deletes its items
```

`add` fetches the feed straight away. `import` only subscribes; the feeds
are fetched on the next poll, and their titles are learnt then.

## Poll

```sh
node bin/news.js poll                  # every feed that is due
node bin/news.js poll --all            # every feed, due or not
node bin/news.js poll --feed <slug>
node bin/news.js poll --limit 20 --quiet
node bin/news.js prune --days 90       # delete items first seen >90 days ago, unless starred
```

Or let the server do it. Put `NEWS_POLL_MINUTES=15` in `.env`: every 15 minutes
it polls whatever is due and prunes once a day. The Feeds page also has
**Poll due feeds now**, and each feed has **Poll now**.

How polling behaves (`NEWS_CONFIG` in `config/preferences.js`):

- **Frequency:** each feed at most once an hour.
- **Conditional GET:** it sends `If-None-Match` / `If-Modified-Since`, so an
  unchanged feed costs one short 304.
- **Politeness:** one request at a time per host with a 2 s pause, 4 hosts
  at once, and an honest user-agent.
- **Failures:** the wait doubles after each one, up to a day, and a server's
  `Retry-After` is respected. `410 Gone` stops polling that feed.
  `401/403/404/451` show as **refused**.
- **Caps:** at most 100 items per poll, newest first, and 5 MB per fetch.
- **New subscriptions:** items older than 14 days start as read, so a new
  feed doesn't bury the river.

## In the browser

| URL | |
|---|---|
| `/news/` | the river: **Unread** / **Starred** / **All**, by feed or tag; **Older →** pages back |
| `/news/item/<id>` | one item: full text, **Read the original**, **Save as bookmark**, **Make a task**, links |
| `/news/feeds` | subscriptions: subscribe (paste a site or feed URL), import (paste OPML or URLs), poll, export OPML |
| `/news/feed/<slug>` | one feed: status, last error, next poll, settings (title, tags), its items, unsubscribe |
| `/news/items.json?view=&feed=&tag=&before=&limit=` | the river as JSON |

- **Read and star:** in place, without reloading (or as plain forms without
  JavaScript). Opening an item's link marks it read. **Mark these N read**
  clears the page shown.
- **Save as bookmark:** creates a GnamGnam bookmark tagged `news` in
  `graph:facet/gnamgnam`, which a re-ingest never drops, unless that URL is
  already bookmarked. It is searchable at once (lexically). Run
  `node bin/ingest.js --only-new` to give it a vector. The item is starred
  and linked to the bookmark.
- **Make a task:** a Farelo task in To do, whose note links the item. The item
  is starred and linked from the task.
- Items whose link you've already bookmarked say **bookmarked** (and the
  item page links the bookmark instead of offering to save it). A feed's
  page lists your bookmarks from the same site; a bookmark's page lists its
  site's feed, or offers to look for one.
- Starred items never expire. Everything else goes after
  `NEWS_CONFIG.retentionDays` (90).

Reading needs no login; everything that changes something needs
`DIM_WRITE_TOKEN` and **log in** (see `docs/commands-gnamgnam.md`).
Changes made with `bin/news.js` show in the web UI after a server restart
(news is cached in memory); polling from the server needs no restart.
