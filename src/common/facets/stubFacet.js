import { sendHtml, esc } from '../http/respond.js'
import { renderPage } from '../ui/layout.js'

/**
 * A placeholder facet: a tab and a page saying what it will be and which
 * phase of docs/plan-detail.md builds it. Replaced by the real facet
 * module when that phase starts.
 */
export function stubFacet ({ id, label, description, phase }) {
  return {
    id,
    label,
    description,
    stub: true,
    routes (router, { tabs }) {
      router.get(`/${id}`, ({ response, session }) => sendHtml(response, 200, renderPage({
        title: label,
        tabs,
        session,
        active: id,
        body: `<h1>${esc(label)}</h1>
<p class="lede">${esc(description)}</p>
<p class="muted">Not built yet — Phase ${esc(phase)} in <code>docs/plan-detail.md</code>.</p>`
      })))
    },
    health () {
      return { status: 'planned', phase }
    }
  }
}

export default stubFacet
