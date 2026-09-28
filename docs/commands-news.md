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
node bin/news.js list                                     # status, unread/total, slug, title (* = failing, set aside)
node bin/news.js park <slug>                              # set a feed aside: not polled
node bin/news.js unpark <slug>                            # return it to reading (starts afresh)
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
node bin/news.js poll --all --refetch  # whole feeds even if unchanged: fills in item dates earlier polls couldn't read
node bin/news.js poll --all --include-failing   # failing feeds too
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
  `Retry-After` is respected. `401/403/404/451` show as **refused**.
- **Failing feeds are set aside:** refused or gone at once, anything else
  after 3 failures in a row (`parkAfterFailures`). A feed set aside isn't
  polled (not by the server, `poll` or `poll --all`) and is listed apart on
  **Manage feeds**. Trying it again (there, on its page, or `poll --feed`)
  brings it back if it works; **Return to reading** gives it a fresh start.
- **Dates:** the river is newest first by each item's own date. Timezone
  abbreviations (BST, CEST, AEST…) are understood; an item with no date sorts
  by when it was first seen, and one dated more than a day ahead is treated as
  undated. A later poll fills in a date that was missing.
- **Caps:** at most 100 items per poll, newest first, and 5 MB per fetch.
- **New subscriptions:** items older than 14 days start as read, so a new
  feed doesn't bury the river.

## In the browser

| URL | |
|---|---|
| `/news/` | the river: **Unread** / **For you** / **Starred** / **All**, by feed or tag; **Older →** pages back. **For you**: unread items closest to your own bookmarks, pages and tasks first (needs the related index: `node bin/related.js`) |
| `/news/item/<id>` | one item: full text, **Read the original**, **Save as bookmark**, **Make a task**, links |
| `/news/admin` | **Manage feeds** (linked from the river): add a feed, import OPML or URLs, and two lists — feeds being read, and failing ones set aside — with reread, set aside / return, and delete for whatever is ticked. `/news/feeds` redirects here |
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
