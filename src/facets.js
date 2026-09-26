import { createGnamgnamFacet } from './gnamgnam/index.js'
import { createTrestleFacet } from './trestle/index.js'
import { createFareloFacet } from './farelo/index.js'
import { createWikiFacet } from './wiki/index.js'
import { createNewsFacet } from './news/index.js'
import { stubFacet } from './common/facets/stubFacet.js'

/**
 * Every facet, in tab order. Explicit on purpose: this list is the whole
 * answer to "what does the app serve?". Stubs are replaced by real facet
 * modules as their phase in docs/plan-detail.md lands.
 */
/**
 * outlines / tasks: an OutlineStore and TaskStore (need the store); without
 * them Trestle and Farelo are stubs. rolls: the dice-roll log. wiki: a
 * WikiStore (likewise). news: { store, poller } (likewise).
 */
export function createFacets ({ search, outlines = null, tasks = null, rolls = null, wiki = null, news = null }) {
  return [
    createGnamgnamFacet({ search }),
    outlines
      ? createTrestleFacet({ store: outlines })
      : stubFacet({ id: 'trestle', label: 'Trestle', phase: 5, description: 'Outliner: the Workflowy outline, editable, with every link one click away.' }),
    tasks
      ? createFareloFacet({ store: tasks, rolls })
      : stubFacet({ id: 'farelo', label: 'Farelo', phase: 6, description: 'Kanban board with Getting Things Diced: pick the next task by a priority-weighted dice roll.' }),
    wiki
      ? createWikiFacet({ store: wiki })
      : stubFacet({ id: 'wiki', label: 'Wiki', phase: 7, description: 'Markdown wiki pages, linked to everything else.' }),
    news
      ? createNewsFacet({ ...news, tasks })
      : stubFacet({ id: 'news', label: 'News', phase: 8, description: 'Newsmonitor: RSS/Atom reader; save items as bookmarks or tasks.' }),
    stubFacet({ id: 'blog', label: 'Blog', phase: 9, description: 'Blog engine: publish wiki pages and outline nodes as posts.' }),
    stubFacet({ id: 'squirt', label: 'Squirt', phase: 10, description: 'Mobile view of everything, with quick capture.' })
  ]
}

export default createFacets
