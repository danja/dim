/**
 * Task rules, pure: states, what may move where, which tasks the dice may
 * pick, and how the board orders them. Tasks are plain objects:
 *   { id, iri, title, status, priority, due, created, position, dependsOn: [iri], project, isProject }
 */

export const STATES = Object.freeze(['backlog', 'todo', 'doing', 'blocked', 'done'])
export const STATE_LABELS = Object.freeze({ backlog: 'Backlog', todo: 'To do', doing: 'Doing', blocked: 'Blocked', done: 'Done' })
export const DEFAULT_PRIORITY = 3
/** The dice draw from work that is ready: to do or under way. */
export const DICE_STATES = new Set(['todo', 'doing'])
/** States a task can't enter while a dependency is unfinished. */
export const NEEDS_DEPENDENCIES = new Set(['doing', 'done'])

export class TaskError extends Error {
  constructor (message, status = 400) {
    super(message)
    this.name = 'TaskError'
    this.status = status
  }
}

export function byIri (tasks) {
  return new Map([...tasks].map(t => [t.iri, t]))
}

/** Dependencies not yet done (unknown IRIs count as pending). */
export function pendingDependencies (task, index) {
  return (task.dependsOn ?? []).filter(dep => index.get(dep)?.status !== 'done')
}

export function checkTransition (task, status, index) {
  if (!STATES.includes(status)) throw new TaskError(`Unknown state ${JSON.stringify(status)}; use ${STATES.join(', ')}`)
  const pending = pendingDependencies(task, index)
  if (NEEDS_DEPENDENCIES.has(status) && pending.length) {
    const names = pending.map(p => index.get(p)?.title ?? p).join(', ')
    throw new TaskError(`Can't move "${task.title}" to ${STATE_LABELS[status]} while it waits on: ${names}`, 409)
  }
}

export function eligibleForDice (task, index) {
  return DICE_STATES.has(task.status) && !task.isProject && pendingDependencies(task, index).length === 0
}

/** Priority, then due date (sooner first, none last), then age (older first). */
export function comparePriority (a, b) {
  const p = (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY)
  if (p) return p
  const ad = a.due ?? '9999-12-31'
  const bd = b.due ?? '9999-12-31'
  if (ad !== bd) return ad < bd ? -1 : 1
  return String(a.created ?? '').localeCompare(String(b.created ?? '')) || a.id.localeCompare(b.id)
}

/** Tasks the dice may pick, best first, minus any excluded ids. */
export function rankForDice (tasks, { exclude = [] } = {}) {
  const index = byIri(tasks)
  const skip = new Set(exclude)
  return [...tasks].filter(t => !skip.has(t.id) && eligibleForDice(t, index)).sort(comparePriority)
}

/** Board columns: state → tasks in their column order. `project` filters. */
export function columns (tasks, { project = null } = {}) {
  const out = Object.fromEntries(STATES.map(s => [s, []]))
  for (const task of tasks) {
    if (project && task.project !== project && task.iri !== project) continue
    out[task.status]?.push(task)
  }
  for (const s of STATES) out[s].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
  out.done.reverse() // most recent at the top
  return out
}
