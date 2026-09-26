import { esc } from '../../common/http/respond.js'
import { formFields } from '../../common/http/write.js'
import { STATES, STATE_LABELS, columns, byIri, pendingDependencies } from '../tasks.js'
import { page, taskPath, titleHtml, metaLine, stateOptions } from './common.js'

/** The Kanban board: one column per state; one column at a time on a phone. */

const DONE_SHOWN = 20

function card (task, { index, session }) {
  const waiting = pendingDependencies(task, index).length
  const move = session?.user
    ? `<details class="card-move"><summary>Move</summary><form method="post" action="${taskPath(task)}/move">${formFields(session, '/farelo/')}<select name="status" aria-label="Move to">${stateOptions(task.status)}</select><button>Move</button></form></details>`
    : ''
  return `<li class="task-card" data-id="${esc(task.id)}"${session?.user ? ' tabindex="0"' : ''}>
${session?.user ? '<span class="grip" aria-hidden="true" title="Drag">⠿</span>' : ''}<div class="card-body"><a class="card-title" href="${taskPath(task)}">${titleHtml(task)}</a>${waiting ? ` <span class="waits" title="Waiting on ${waiting} task${waiting === 1 ? '' : 's'}">⏳</span>` : ''}
<div class="meta">${metaLine(task, { index })}</div>${move}</div>
</li>`
}

function column (status, tasks, ctx, { allDone }) {
  const shown = status === 'done' && !allDone ? tasks.slice(0, DONE_SHOWN) : tasks
  const more = shown.length < tasks.length ? `<p class="meta"><a href="/farelo/?done=all">all ${tasks.length} done</a></p>` : ''
  return `<section class="column" id="col-${status}" aria-labelledby="col-${status}-h">
<h2 id="col-${status}-h">${esc(STATE_LABELS[status])} <span class="count">${tasks.length}</span></h2>
<ol class="cards" data-status="${status}">${shown.map(t => card(t, ctx)).join('')}</ol>${more}
</section>`
}

function newTaskForm (session, project) {
  if (!session?.user) return session?.writesEnabled ? '<p class="meta"><a href="/login?return=/farelo/">Log in</a> to add and move tasks.</p>' : ''
  return `<form class="new-task" method="post" action="/farelo/tasks">${formFields(session, '/farelo/')}
<input type="text" name="title" required placeholder="New task" aria-label="New task" autocomplete="off">
<select name="status" aria-label="Column">${stateOptions('todo')}</select>
<select name="priority" aria-label="Priority">${[1, 2, 3, 4, 5].map(p => `<option value="${p}"${p === 3 ? ' selected' : ''}>P${p}</option>`).join('')}</select>
${project ? `<input type="hidden" name="project" value="${esc(project.id)}">` : ''}
<button>Add</button>
</form>`
}

export function renderBoard ({ tasks, projectId = null, allDone = false, tabs, session }) {
  const index = byIri(tasks)
  const projects = tasks.filter(t => t.isProject && t.status !== 'done')
  const project = projectId ? tasks.find(t => t.id === projectId && t.isProject) : null
  const cols = columns(tasks, { project: project?.iri ?? null })
  const filter = projects.length
    ? `<form class="filter" method="get" action="/farelo/"><select name="project" aria-label="Project"><option value="">All projects</option>${projects.map(p => `<option value="${esc(p.id)}"${p.id === project?.id ? ' selected' : ''}>${esc(p.title)}</option>`).join('')}</select><button>Show</button></form>`
    : ''
  const colTabs = STATES.map(s => `<a href="#col-${s}">${esc(STATE_LABELS[s])} <span class="count">${cols[s].length}</span></a>`).join('')
  const body = `<div class="board-head"><h1>Tasks</h1><a class="dice-link" href="/farelo/dice">🎲 Roll for the next task</a></div>
${filter}
${newTaskForm(session, project)}
<nav class="col-tabs" aria-label="Columns">${colTabs}</nav>
<div class="board">${STATES.map(s => column(s, cols[s], { index, session }, { allDone })).join('\n')}</div>`
  return page({ title: project ? `${project.title} — Tasks` : 'Tasks', body, tabs, session })
}
