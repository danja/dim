/**
 * What an agent can do in DIM: every write route, and the reads that answer
 * in a form worth reading. dim_endpoints serves it, so an agent needn't guess
 * paths or body fields. `example` is a concrete path the route matches;
 * tests/mcp checks that every write route in the app is listed here.
 *
 * Bodies are JSON. Reads take `.json` (or `.md`/`.ttl` where noted); a page
 * without one comes back as its text.
 */

const w = (path, example, does, body = '') => ({ method: 'POST', path, example, does, body })
const r = (path, example, does) => ({ method: 'GET', path, example, does })

export const CATALOG = Object.freeze([
  // Across facets
  r('/find.json?q=&facet=&limit=&ranked=1', '/find.json', 'Search every facet; ranked=1 gives one list ranked by meaning and words (dim_search wraps this)'),
  r('/tags.json', '/tags.json', 'Every tag in use, with counts'),
  r('/tags/{tag}.json', '/tags/x.json', 'Everything carrying a tag, by facet'),
  r('/topics.json', '/topics.json', 'Topics (SKOS) with member counts'),
  r('/topics/{slug}.json', '/topics/x.json', 'One topic: what it groups, by facet'),
  r('/links?iri=', '/links', 'Links of a resource (IRI http://purl.org/stuff/dim/<type>/<slug>)'),
  r('/day/{yyyy-mm-dd}', '/day/2026-01-01', 'What was done on a day (the change log)'),
  r('/week/{yyyy-mm-dd}', '/week/2026-01-01', 'What was done in a week'),
  r('/health', '/health', 'Per-facet status, backups'),
  w('/links', '/links', 'Link two resources', '{ from, to, kind? = "related" }; from/to: IRI, DIM URL or [[type/slug]]'),
  w('/links/delete', '/links/delete', 'Remove a link', '{ from, to, kind? }'),

  // Bookmarks (gnamgnam)
  r('/gnamgnam/search?q=&bookmarkType=&domain=', '/gnamgnam/search', 'Hybrid bookmark search'),
  r('/gnamgnam/facets', '/gnamgnam/facets', 'Bookmark facet values and counts'),
  r('/gnamgnam/bookmarks?...', '/gnamgnam/bookmarks', 'Browse bookmarks'),
  r('/gnamgnam/bookmark/{slug}(.json|.ttl)', '/gnamgnam/bookmark/x.json', 'One bookmark'),
  w('/gnamgnam/bookmark/{slug}/annotations', '/gnamgnam/bookmark/x/annotations', 'Set a bookmark\'s tags and note', '{ tags, note }'),

  // Outliner (trestle)
  r('/trestle/outline/{slug}(.md|.ttl)', '/trestle/outline/x.md', 'An outline'),
  r('/trestle/node/{id}(.md|.json)', '/trestle/node/abc123.json', 'A node and its subtree'),
  r('/trestle/tree?...', '/trestle/tree', 'Outline tree data'),
  w('/trestle/outlines', '/trestle/outlines', 'New outline', '{ title }'),
  w('/trestle/nodes', '/trestle/nodes', 'New node', '{ title, outline? | parent? | after? } (parent/after: node id)'),
  w('/trestle/node/{id}', '/trestle/node/abc123', 'Edit a node', '{ title?, note?, collapsed? }'),
  w('/trestle/node/{id}/move', '/trestle/node/abc123/move', 'Move a node', '{ op } (indent | outdent | up | down)'),
  w('/trestle/node/{id}/delete', '/trestle/node/abc123/delete', 'Delete a node'),

  // Tasks (farelo)
  r('/farelo', '/farelo', 'The board'),
  r('/farelo/task/{id}(.json)', '/farelo/task/ta1b2c.json', 'One task'),
  r('/farelo/dice', '/farelo/dice', 'The dice list'),
  r('/farelo/next', '/farelo/next', 'What next? — the advisor\'s ranking'),
  w('/farelo/tasks', '/farelo/tasks', 'New task', '{ title, note?, priority?, due?, estimate?, tags?, project?, isProject?, dependsOn? }'),
  w('/farelo/task/{id}', '/farelo/task/ta1b2c', 'Edit a task', 'any of { title, note, priority, due, estimate, tags, project, isProject, dependsOn }'),
  w('/farelo/task/{id}/move', '/farelo/task/ta1b2c/move', 'Change status / position', '{ status?, before?, after? } (before/after: task id)'),
  w('/farelo/task/{id}/delete', '/farelo/task/ta1b2c/delete', 'Delete a task'),
  w('/farelo/dice', '/farelo/dice', 'Roll for the next task', '{ policy?, exclude?, skip?, lastTask?, lastTarget? }'),
  w('/farelo/next/{id}/accept', '/farelo/next/ta1b2c/accept', 'Accept the advisor\'s pick (start it)', '{ shown?, ...context }'),
  w('/farelo/next/{id}/skip', '/farelo/next/ta1b2c/skip', 'Skip the advisor\'s pick', '{ rank? }'),
  w('/farelo/next/explain', '/farelo/next/explain', 'Ask for an explanation of the ranking', '{ ...context }'),
  w('/farelo/next/weights/reset', '/farelo/next/weights/reset', 'Reset the advisor\'s learned weights'),

  // Wiki
  r('/wiki', '/wiki', 'Page list'),
  r('/wiki/page/{slug}(.md|.json)', '/wiki/page/x.md', 'A page'),
  r('/wiki/page/{slug}/history', '/wiki/page/x/history', 'Revisions'),
  r('/wiki/page/{slug}/r/{n}', '/wiki/page/x/r/1', 'One revision'),
  r('/wiki/page/{slug}/diff?from=&to=', '/wiki/page/x/diff', 'Diff between revisions'),
  w('/wiki/page/{slug}', '/wiki/page/x', 'Create or save a page (slug from title when new)', '{ title, content, tags?, base? } base: the revision edited from (conflict check)'),
  w('/wiki/page/{slug}/delete', '/wiki/page/x/delete', 'Delete a page'),

  // News
  r('/news?...', '/news', 'The river'),
  r('/news/items.json?...', '/news/items.json', 'Items as JSON'),
  r('/news/item/{id}(.json)', '/news/item/0123456789abcdef.json', 'One item'),
  r('/news/feed/{slug}(.json)', '/news/feed/x.json', 'One feed'),
  r('/news/feeds.opml', '/news/feeds.opml', 'Subscriptions as OPML'),
  w('/news/items/flags', '/news/items/flags', 'Mark items read / starred', '{ ids: [id…], read?: bool, starred?: bool }'),
  w('/news/item/{id}/bookmark', '/news/item/0123456789abcdef/bookmark', 'Save an item as a bookmark'),
  w('/news/item/{id}/task', '/news/item/0123456789abcdef/task', 'Make an item a task'),
  w('/news/feeds', '/news/feeds', 'Subscribe (feed or site URL)', '{ url, tags? }'),
  w('/news/feeds/import', '/news/feeds/import', 'Import subscriptions', '{ list } (OPML or one URL per line)'),
  w('/news/feed/{slug}', '/news/feed/x', 'Edit a feed', '{ title?, tags? }'),
  w('/news/feed/{slug}/poll', '/news/feed/x/poll', 'Poll one feed now'),
  w('/news/feed/{slug}/delete', '/news/feed/x/delete', 'Delete a feed and its items'),
  w('/news/feed/{slug}/park', '/news/feed/x/park', 'Set a feed aside'),
  w('/news/poll', '/news/poll', 'Poll every due feed'),
  w('/news/admin', '/news/admin', 'Manage feeds in bulk (the Manage feeds page)', '{ action: subscribe|dismiss|reread|reread-all|park|unpark|delete, slugs?: [], suggestions?: [] }'),

  // Blog
  r('/blog/post/{slug}(.md|.json)', '/blog/post/x.json', 'A post (drafts included: you are the owner)'),
  r('/blog', '/blog', 'Published posts'),
  w('/blog/posts', '/blog/posts', 'New draft', '{ title, content?, tags? } or { from } (a wiki page or outline node, as a URL, IRI or [[Title]])'),
  w('/blog/post/{slug}', '/blog/post/x', 'Edit a post', '{ title?, content?, tags?, abstract?, action?: "preview" }'),
  w('/blog/post/{slug}/publish', '/blog/post/x/publish', 'Publish or unpublish', '{ publish: true|false }'),
  w('/blog/post/{slug}/delete', '/blog/post/x/delete', 'Delete a post'),

  // Calendar (appointments; owner only)
  r('/calendar', '/calendar', 'Upcoming appointments, soonest first (?view=past for earlier ones)'),
  r('/calendar/event/{slug}(.json)', '/calendar/event/x.json', 'An appointment'),
  w('/calendar/events', '/calendar/events', 'New appointment', '{ title, date: YYYY-MM-DD, time?: HH:MM, location?, notes? }'),
  w('/calendar/event/{slug}', '/calendar/event/x', 'Edit an appointment', '{ title?, date?, time?, location?, notes? } (an empty time makes it all-day)'),
  w('/calendar/event/{slug}/delete', '/calendar/event/x/delete', 'Delete an appointment'),

  // Capture (squirt)
  r('/squirt/recent.json', '/squirt/recent.json', 'The timeline of recent captures'),
  w('/squirt/capture', '/squirt/capture', 'Capture a URL, note or task; DIM decides what it is unless kind is given', '{ text?, url?, title?, kind? }')
])

export default CATALOG
