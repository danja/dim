# TODO

## From INBOX.md

- [x] Need an easy way of deleting tasks
- [x] Understand hashtags in content - maybe use a SKOS vocab?

## From DIM's task list (Farelo, To do, #dim)

- [x] A button to create a wiki page and/or Trestle outline item from a Farelo task, linked in both directions
- [x] Allow editing of tasks (inline Edit on each board card; the task page keeps the full form)
- [x] Import bookmarks from browsers (marked "doing" in Farelo)
- [x] Make a neater Wiki landing page with recent items
- [ ] Allow notes to become Todo items and vice versa

Not added: three "make it easy to remove tasks" tasks, now done by the Archive button
(they can be archived in DIM).

## Graph RAG follow-ups

- [ ] Judge `bin/ask.js` on 10–20 real questions; tune `RAG_CONFIG`
- [x] Hashtag edges in expansion (shared `#tags` through the links graph)
- [x] Similarity edges and community summaries, as options (`docs/rag.md`)
- [ ] Try the options on live data (`bin/communities.js`, then `bin/ask.js --similar --communities`); settle the defaults
- [x] Similarity edges as input to community detection (`bin/communities.js --similar`; judge the result on live data, see HUMANS.md)
