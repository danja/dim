import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { taskPath } from './common.js'

/**
 * A project page as a hub: its tasks' progress, and everything in DIM that
 * is part of it — wiki pages, outline items, bookmarks, feeds, posts (linked
 * "part of" from any page's links panel, or with the form here) — plus the
 * resources its tasks use.
 */

const DAY = 86400000

/** links: resolved links of the project; taskLinks: Map task iri → resolved links. */
export function gatherProject ({ project, tasks, links, taskLinks }) {
  const children = tasks.filter(t => t.project === project.iri)
  const group = entries => {
    const out = new Map()
    for (const e of entries) {
      if (!e.href) continue
      const g = out.get(e.facetLabel ?? 'Elsewhere') ?? []
      if (!g.some(x => x.iri === e.iri)) g.push(e)
      out.set(e.facetLabel ?? 'Elsewhere', g)
    }
    return [...out]
  }
  const contains = group((Array.isArray(links) ? links : []).filter(l => l.kind === 'partOf' && l.direction === 'in' && l.facet !== 'farelo'))
  const viaTasks = group([...taskLinks.values()].flatMap(ls => (Array.isArray(ls) ? ls : []).filter(l => l.kind === 'resource' && l.direction === 'out')))
  const stamps = [project, ...children].map(t => t.modified ?? t.doneAt ?? t.created).filter(Boolean).sort()
  return {
    total: children.length,
    done: children.filter(t => t.status === 'done').length,
    lastActivity: stamps.at(-1) ?? null,
    contains,
    viaTasks
  }
}

function groups (entries) {
  return entries.map(([label, items]) => `<h3>${esc(label)}</h3><ul>${items.map(i => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join('')}</ul>`).join('')
}

export function renderProjectHub (hub, { project, session, now = new Date() }) {
  if (!hub) return ''
  const idle = hub.lastActivity ? Math.floor((now - Date.parse(hub.lastActivity)) / DAY) : null
  const progress = hub.total ? `${hub.done} of ${hub.total} tasks done` : 'no tasks yet'
  const add = session?.user
    ? `<form class="add-link" method="post" action="/links">${formFields(session, taskPath(project))}<input type="hidden" name="to" value="${esc(project.iri)}"><input type="hidden" name="kind" value="partOf">
<input type="text" name="from" data-picker required autocomplete="off" placeholder="add a page, outline item, bookmark, feed… (search or paste)" aria-label="Add to this project">
<button>Add</button>
</form>`
    : ''
  return `<section class="project-hub" aria-labelledby="hub-h">
<h2 id="hub-h">This project</h2>
<p class="meta">${progress}${idle !== null ? ` · last activity ${idle === 0 ? 'today' : `${idle} day${idle === 1 ? '' : 's'} ago`}` : ''}</p>
${hub.contains.length ? groups(hub.contains) : '<p class="muted">Nothing gathered here yet: link pages, outline items or bookmarks as <em>part of</em> this project.</p>'}
${hub.viaTasks.length ? `<h3 class="sub">Used by its tasks</h3>${groups(hub.viaTasks)}` : ''}
${add}
</section>`
}
