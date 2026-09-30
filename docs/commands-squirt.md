# Squirt — DIM on your phone

After [danja/squirt](https://github.com/danja/squirt). Squirt is DIM's front page
for a phone: search first, one capture box that sends things to the right
place, and what changed lately across every facet. It also makes DIM an
installable app, with a share target and offline reading of pages you've
opened. Background: `docs/plan-detail.md` (Phase 10).

## Capture

`/squirt/`, logged in. What you type decides where it goes (or pick
**Save as**):

| You type | It becomes |
|---|---|
| `todo call Ann` · `task: …` · `- [ ] …` | a Farelo task in To do (tag `squirt`); later lines become its note |
| a URL, with or without words | a GnamGnam bookmark (tag `squirt`); the words become its title |
| anything else | a note at the top of the wiki page **Inbox**, under a time heading; `[[Title]]` links work |

Bookmarks go into `graph:facet/gnamgnam` and are searchable at once; they
are fetched, summarised and embedded in the background as they are saved
(`docs/commands-gnamgnam.md`). A URL that is already bookmarked isn't
duplicated.

## Search

The box at the top searches everything, one ranked list (`/find`): by
meaning, over everything DIM embeds — bookmarks, wiki pages, blog posts,
tasks, outline items and news items — and by words, over each facet's own
search. A hit found both ways ranks first; each says where it's from and
how it matched, and the links above the results narrow to one facet. New
and changed things are embedded by the server's related sync
(`RELATED_SYNC_MINUTES`, default every 30 minutes; `node bin/related.js`
by hand). While Ollama is down the search uses words only, and says so.

From a script:

```sh
curl -s -X POST localhost:4110/squirt/capture -H "Authorization: Bearer $DIM_WRITE_TOKEN" \
  -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{"text":"todo oil the lathe"}'
```

## Today and this week

`/day` shows what you did today, grouped by facet, with times and change
summaries, plus what arrived (news). `/day/2026-09-22` shows another day.
`/week` is a review of seven days: counts per day, and the tasks done, wiki
pages started, bookmarks saved and posts published. Both are linked from
Squirt, and are for the owner only.

## Lately

The latest change to each thing you've touched, in any facet, plus the
newest unread news. It comes from the change log (`graph:system/changes`).
It is shown only when logged in, since it includes drafts' titles. Also
available as JSON: `/squirt/recent.json`.

## Install on a phone, share into DIM

1. **Serve DIM over https.** Browsers only install apps and run service
   workers in a secure context: `localhost`, or https. On a phone that
   means a reverse proxy with a certificate, for example `tailscale serve`
   or Caddy in front of port 4110 (Phase 12 covers this). Over plain
   `http://192.168.…` DIM works as normal web pages, but can't be installed
   or used offline.
2. Open `/squirt/` on the phone and choose **Install app** (Chrome) or
   **Add to Home Screen** (Safari).
3. In any app, **Share → DIM** opens a capture form filled with the shared
   title, text and link, with a guess of where it will go. Tap **Save**.
   You need to have logged in once on the phone; the session lasts 30 days.

The **bookmarklet** on `/squirt/` (under *On your phone, and from any page*)
does the same from a desktop browser: it sends the current page, and any
selected text, to the capture form.

## Offline

A service worker (`/squirt/sw.js`, scope `/`) fetches from the network
first. It keeps the last copy of each page you open (up to 300) and shows
that copy when DIM can't be reached. A page you haven't opened on that
device shows an offline notice. **Log out** clears the saved copies.

### News and notes offline

When logged in, `/squirt/` keeps the summaries of the 10 newest news items
in the browser's localStorage (refreshed on each visit and when the
connection returns) and lists them under **News on this device**. Each has
an **Add a note** box, and the capture box also works offline. Both go into
a queue on the device (`dim.offline.queue`) and are sent to
`/squirt/capture` when you're back online, in order. A note on a news item
lands in the wiki Inbox as `Re: <title>`, with the item's link. Captures
the server refuses (4xx other than 401/403) are dropped; a server error or
an expired session leaves them queued. Notes are only synced by an open
Squirt page, not in the background. Logging out clears the stored news and
the queue.
