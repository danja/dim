# Calendar — Commands and use

A simple place to remember appointments: what, which day, and optionally
when and where. Appointments live in `graph:facet/calendar`. Background:
`docs/plan-detail.md` (Phase 14).

It is private. Everything under `/calendar/` needs you logged in
(`DIM_WRITE_TOKEN`; see `docs/commands-gnamgnam.md`), even when reads are
otherwise public: a browser is sent to the login page, and a JSON request
gets 401. Appointments don't appear in search (`/find`), tags, related items
or the day view.

## Using it

`/calendar/` lists what's coming, soonest first, grouped by day (today and
tomorrow are named). Above the list is the form to add one:

| Field | Notes |
|---|---|
| What | The title, up to 200 characters. |
| Date | Required. |
| Time | Optional, as `HH:MM` (24 hours). Without it the appointment is **All day**, and sorts first that day. |
| Where | Optional, up to 200 characters. |
| Notes | Optional, up to 5000 characters. Plain text, shown under the title. |

Tap a time or title to edit it, or **Delete** it (after a confirmation).
**Past appointments** (a link under the list) shows earlier days, latest
first. Nothing is deleted when its day passes.

Dates and times are kept as written, with no timezone: an appointment at
14:30 is at 14:30 wherever you are. "Today" is the server's local day.

## Coming up

When you're logged in, the Squirt page (`/squirt/`, the phone front page)
starts with a **Coming up** panel: what's due today and the next two days,
by day and time, with the place under the title. Today's timed appointments
that have already started are greyed. Tap one to edit it. With nothing due
the panel isn't there, and it never appears to anyone who isn't logged in.
It is part of the page the phone keeps for offline use, so it shows the last
list it saw.

To change how far ahead it looks, change `days: 2` in `src/squirt/api/routes.js`.

## For scripts and MCP

Send the write token as a Bearer token and ask for JSON:

| Route | What |
|---|---|
| `GET /calendar/` | `{ view, events }`: upcoming; `?view=past` for earlier ones |
| `GET /calendar/event/<slug>.json` | One appointment |
| `POST /calendar/events` | `{ title, date, time?, location?, notes? }` → `{ ok, slug, iri }` |
| `POST /calendar/event/<slug>` | Change any of those fields; an empty `time` makes it all-day |
| `POST /calendar/event/<slug>/delete` | Delete |

An appointment is `dim:Event` with IRI `http://purl.org/stuff/dim/event/<slug>`
(`dim:eventDate` as `xsd:date`, `dim:eventTime`, `dim:location`,
`dcterms:title`, `dcterms:description`); the shape is `dim:EventShape` in
`vocabs/shapes.ttl`. Changes are SHACL-checked and go in the change log like
every other facet's.
