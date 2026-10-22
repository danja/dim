# TODO

## From INBOX.md

- [x] Need an easy way of deleting tasks
- [x] Understand hashtags in content - maybe use a SKOS vocab?

## From DIM's task list (Farelo, To do, #dim)

- [x] A button to create a wiki page and/or Trestle outline item from a Farelo task, linked in both directions
- [ ] Allow editing of tasks (the task page has an Edit form; presumably wants quicker editing from the board, check with Danny)
- [x] Import bookmarks from browsers (marked "doing" in Farelo)

Not added: three "make it easy to remove tasks" tasks, now done by the Archive button
(they can be archived in DIM).

## Graph RAG follow-ups

- [ ] Judge `bin/ask.js` on 10–20 real questions; tune `RAG_CONFIG`
- [ ] Hashtag edges in expansion (shared `#tags` through the links graph)
- [x] Similarity edges and community summaries, as options (`docs/rag.md`)
- [ ] Try the options on live data (`bin/communities.js`, then `bin/ask.js --similar --communities`); settle the defaults
- [ ] Similarity edges as input to community detection
