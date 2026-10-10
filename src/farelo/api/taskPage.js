import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { renderMarkdown } from '../../common/ui/markdown.js'
import { renderLinksPanel } from '../../common/ui/linksPanel.js'
import { STATES, STATE_LABELS, byIri, pendingDependencies } from '../tasks.js'
import { page, taskPath, titleHtml, metaLine, stateBadge } from './common.js'
import { renderRelated } from '../../common/ui/relatedPanel.js'
import { renderProjectHub } from './projectHub.js'

/** One task: details, dependencies, note, links, history, and editing. */

function statusButtons (task, { session, blocked }) {
  if (!session?.user) return ''
  const buttons = STATES.filter(s => s !== task.status)
    .map(s => `<button name="status" value="${s}"${blocked && ['doing', 'done'].includes(s) ? ' disabled title="Waiting on other tasks"' : ''}>${esc(STATE_LABELS[s])}</button>`).join('')
  return `<form class="inline-buttons" method="post" action="${taskPath(task)}/move">${formFields(session, taskPath(task))}${buttons}</form>`
}

function dependencyList (task, index) {
  if (!task.dependsOn.length) return ''
  const items = task.dependsOn.map(iri => {
    const dep = index.get(iri)
    return dep ? `<li>${stateBadge(dep.status)} <a href="${taskPath(dep)}">${titleHtml(dep)}</a></li>` : `<li class="muted">${esc(iri)} (missing)</li>`
  }).join('')
  return `<h2>Waits on</h2><ul class="deps">${items}</ul>`
}

function editForm (task, { tasks, session }) {
  if (!session?.user) return ''
  const others = tasks.filter(t => t.id !== task.id && t.status !== 'done')
  const projects = tasks.filter(t => t.isProject && t.id !== task.id)
  const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`
  return `<details><summary>Edit</summary>
<form class="edit" method="post" action="${taskPath(task)}">${formFields(session, taskPath(task))}
<label for="t-title">Title</label><input type="text" id="t-title" name="title" value="${esc(task.title)}" required>
<label for="t-note">Note (Markdown)</label><textarea id="t-note" name="note">${esc(task.note ?? '')}</textarea>
<label for="t-priority">Priority</label><select id="t-priority" name="priority">${[1, 2, 3, 4, 5].map(p => opt(p, `P${p}${p === 1 ? ' (highest)' : p === 5 ? ' (lowest)' : ''}`, task.priority === p)).join('')}</select>
<label for="t-due">Due</label><input type="date" id="t-due" name="due" value="${esc(task.due ?? '')}">
<label for="t-estimate">Estimate (minutes)</label><input type="number" id="t-estimate" name="estimate" min="0" value="${esc(task.estimate ?? '')}">
<label for="t-tags">Contexts / tags, comma-separated</label><input type="text" id="t-tags" name="tags" value="${esc((task.tags ?? []).join(', '))}">
<label for="t-project">Project</label><select id="t-project" name="project">${opt('', '(none)', !task.project)}${projects.map(p => opt(p.id, p.title, task.project === p.iri)).join('')}</select>
<label><input type="checkbox" name="isProject" value="true"${task.isProject ? ' checked' : ''}> This is a project</label>
<input type="hidden" name="isProject" value="false">
<label for="t-deps">Waits on (Ctrl/⌘-click for several)</label><select id="t-deps" name="dependsOn" multiple size="${Math.min(8, Math.max(3, others.length))}">${others.map(o => opt(o.id, o.title, task.dependsOn.includes(o.iri))).join('')}</select>
<input type="hidden" name="dependsOn" value="">
<button>Save</button>
</form>
</details>
${task.archivedAt
    ? `<form class="inline-buttons" method="post" action="${taskPath(task)}/restore">${formFields(session, taskPath(task))}<button>Restore task</button></form>`
    : `<form class="inline-buttons" method="post" action="${taskPath(task)}/archive" data-confirm="Archive this task? It is hidden, not erased.">${formFields(session, '/farelo/')}<button class="danger">Archive task</button></form>`}`
}

function history (entries) {
  if (!entries?.length) return ''
  return `<details class="history"><summary>History</summary><ol>${entries.map(e => `<li><time datetime="${esc(e.at)}">${esc(String(e.at).slice(0, 16).replace('T', ' '))}</time> ${esc(e.comment ?? e.action)}</li>`).join('')}</ol></details>`
}

export function renderTaskPage ({ task, tasks, links, related = null, hub = null, historyEntries, tabs, session }) {
  const index = byIri(tasks)
  const waiting = pendingDependencies(task, index).length > 0
  const children = tasks.filter(t => t.project === task.iri)
  const linksHtml = renderLinksPanel(links, { subject: task.iri, session, returnPath: taskPath(task) })
  const body = `<nav class="crumbs" aria-label="Breadcrumbs"><a href="/farelo/">Tasks</a>${task.project && index.get(task.project) ? ` › <a href="${taskPath(index.get(task.project))}">${esc(index.get(task.project).title)}</a>` : ''}</nav>
<h1>${titleHtml(task)}</h1>
${task.archivedAt ? `<p class="muted">Archived ${esc(String(task.archivedAt).slice(0, 10))}. <a href="/farelo/archived">All archived tasks</a></p>` : ''}
<p>${stateBadge(task.status)} <span class="meta">${metaLine(task, { index, projects: false })}</span>${waiting ? ' <span class="waits">⏳ waiting</span>' : ''}</p>
${statusButtons(task, { session, blocked: waiting })}
${task.note ? `<div class="note">${renderMarkdown(task.note)}</div>` : ''}
${dependencyList(task, index)}
${children.length ? `<h2>In this project</h2><ul class="deps">${children.map(c => `<li>${stateBadge(c.status)} <a href="${taskPath(c)}">${titleHtml(c)}</a></li>`).join('')}</ul>` : ''}
${renderProjectHub(hub, { project: task, session })}
${renderRelated(related)}
${linksHtml}
${editForm(task, { tasks, session })}
${history(historyEntries)}`
  return page({ title: task.title, body, tabs, session })
}
