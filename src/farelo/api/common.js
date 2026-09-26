import { esc } from '../../common/http/respond.js'
import { renderPage } from '../../common/ui/layout.js'
import { renderInline } from '../../common/ui/markdown.js'
import { LINK_PICKER_SCRIPT } from '../../common/ui/linksPanel.js'
import { STATE_LABELS } from '../tasks.js'

/** Bits shared by the Farelo pages. */

export const taskPath = task => `/farelo/task/${task.id}`
export const BOARD_SCRIPT = '<script type="module" src="/static/js/board.js"></script>'

export function page ({ title, body, tabs, session, head = '' }) {
  const scripts = session?.user ? `${BOARD_SCRIPT}\n${LINK_PICKER_SCRIPT}` : ''
  return renderPage({ title, tabs, active: 'farelo', session, body, head: `${scripts}${head}` })
}

export function titleHtml (task) {
  return renderInline(task.title)
}

export function stateBadge (status) {
  return `<span class="badge state-${esc(status)}">${esc(STATE_LABELS[status] ?? status)}</span>`
}

/** "P2 · due 2026-10-01 · 30 min · Project" */
export function metaLine (task, { index, projects = true } = {}) {
  const parts = []
  if (task.priority != null) parts.push(`<span class="prio prio-${task.priority}" title="Priority ${task.priority}">P${task.priority}</span>`)
  if (task.due) parts.push(`<span class="due">due ${esc(task.due)}</span>`)
  if (task.estimate != null) parts.push(`${task.estimate} min`)
  if (projects && task.project && index?.get(task.project)) {
    const p = index.get(task.project)
    parts.push(`<a href="${taskPath(p)}">${esc(p.title)}</a>`)
  }
  if (task.isProject) parts.push('<span class="badge">project</span>')
  for (const tag of task.tags ?? []) parts.push(`<span class="tag">${esc(tag)}</span>`)
  return parts.join(' · ')
}

export function stateOptions (selected) {
  return Object.entries(STATE_LABELS).map(([s, label]) => `<option value="${s}"${s === selected ? ' selected' : ''}>${esc(label)}</option>`).join('')
}
