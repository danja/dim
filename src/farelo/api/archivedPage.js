import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { page, taskPath, titleHtml, stateBadge } from './common.js'

/** Archived tasks: hidden from the board, kept here so they can be restored. */

export function renderArchived ({ tasks, tabs, session }) {
  const items = tasks.map(t => `<li>${stateBadge(t.status)} <a href="${taskPath(t)}">${titleHtml(t)}</a> <span class="meta">archived ${esc(String(t.archivedAt).slice(0, 10))}</span>${session?.user
    ? ` <form class="inline-buttons" method="post" action="${taskPath(t)}/restore">${formFields(session, '/farelo/archived')}<button>Restore</button></form>`
    : ''}</li>`).join('')
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/farelo/">Tasks</a></nav>
<h1>Archived tasks</h1>
${items ? `<ul class="deps">${items}</ul>` : '<p class="muted">Nothing archived.</p>'}`
  return page({ title: 'Archived tasks', body, tabs, session })
}
