import { iri } from '../common/store/SPARQLHelper.js'
import QueryService from '../common/store/QueryService.js'
import GraphWriter from '../common/store/GraphWriter.js'
import { positionBetween, needsRenumber } from '../common/store/positions.js'
import { TASK_PREDICATES, taskTriples, schemeTriples, stateOf, taskIri, newTaskId, SCHEME } from './rdf.js'
import { byIri, checkTransition, columns, TaskError, STATES } from './tasks.js'

/**
 * Tasks in graph:facet/farelo, held in memory (loaded once) and written
 * through the Phase 4 write path. Every write rewrites the task's whole
 * description, so a task is always valid as a unit.
 */

const MAX_TAGS = 20

function cleanTags (value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',')
  return [...new Set(raw.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, MAX_TAGS)
}

function int (value, { min, max, name }) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) throw new TaskError(`${name} must be a whole number from ${min} to ${max}`)
  return n
}

function date (value) {
  if (!value) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) throw new TaskError('Due date must be YYYY-MM-DD')
  return String(value)
}

export class TaskStore {
  constructor ({ client, repository, links = null, queries = new QueryService(), now = () => new Date() }) {
    if (!client || !repository) throw new Error('TaskStore needs a client and a Repository')
    Object.assign(this, { client, repository, links, queries, now })
    this.tasks = null
  }

  async graph () {
    return this.repository.facetGraph('farelo', { comment: 'Tasks (Farelo)' })
  }

  /** The task-state concept scheme, written once to graph:alignment/task-states. */
  async #ensureScheme () {
    const registry = this.repository.registry
    if (await registry.isRegistered('alignment', 'task-states')) return
    const graph = await registry.register({ kind: 'alignment', id: 'task-states', licence: 'CC0-1.0', derivedFrom: SCHEME, comment: 'SKOS scheme of task states' })
    await new GraphWriter(this.client, { registry }).writeGrouped(graph, [schemeTriples()])
  }

  async all () {
    if (this.tasks) return this.tasks
    await this.#ensureScheme()
    const rows = await this.client.select(this.queries.get('farelo/tasks', { graph: iri(await this.graph()) }))
    this.tasks = new Map(rows.map(r => {
      const id = r.task.slice(r.task.lastIndexOf('/') + 1)
      return [id, {
        id,
        iri: r.task,
        title: r.title,
        status: stateOf(r.status),
        position: Number(r.position),
        created: r.created ?? null,
        modified: r.modified ?? null,
        note: r.note ?? null,
        priority: r.priority != null ? Number(r.priority) : null,
        due: r.due ?? null,
        estimate: r.estimate != null ? Number(r.estimate) : null,
        project: r.project ?? null,
        doneAt: r.doneAt ?? null,
        isProject: r.isProject === 'true',
        dependsOn: r.deps ? r.deps.split(' ').filter(Boolean) : [],
        tags: r.tags ? r.tags.split(', ').filter(Boolean) : []
      }]
    }))
    return this.tasks
  }

  async list () {
    return [...(await this.all()).values()]
  }

  async get (id) {
    return (await this.all()).get(id) ?? null
  }

  async #write (task, actor, summary) {
    await this.repository.replace({ graph: await this.graph(), subject: task.iri, predicates: TASK_PREDICATES, triples: taskTriples(task), actor, summary })
    ;(await this.all()).set(task.id, task)
    return task
  }

  /** The end of a column (or a spot after/before a task in it). */
  async #place (status, { before = null, after = null } = {}) {
    const column = columns(await this.list())[status]
    if (status === 'done') column.reverse()
    if (after || before) {
      const anchorId = after ?? before
      const i = column.findIndex(t => t.id === anchorId)
      if (i === -1) throw new TaskError('No such task to place next to')
      const [lo, hi] = after ? [column[i].position, column[i + 1]?.position ?? null] : [column[i - 1]?.position ?? null, column[i].position]
      // Neighbours too close to split (after very many inserts in one spot):
      // the task goes to the end of the column instead.
      if (!needsRenumber(lo, hi)) return positionBetween(lo, hi)
    }
    return positionBetween(column.at(-1)?.position ?? null, null)
  }

  /** Validate and normalise user fields into a task. */
  async #apply (task, fields) {
    const next = { ...task }
    if ('title' in fields) next.title = String(fields.title ?? '').trim()
    if (!next.title) throw new TaskError('A task needs a title')
    if ('note' in fields) next.note = String(fields.note ?? '').replace(/\r\n/g, '\n').trim() || null
    if ('priority' in fields) next.priority = int(fields.priority, { min: 1, max: 5, name: 'Priority' })
    if ('estimate' in fields) next.estimate = int(fields.estimate, { min: 0, max: 100000, name: 'Estimate' })
    if ('due' in fields) next.due = date(fields.due)
    if ('tags' in fields) next.tags = cleanTags(fields.tags)
    // A form sends the checkbox and its hidden 'false' fallback: any truthy value wins.
    if ('isProject' in fields) next.isProject = [].concat(fields.isProject).some(v => [true, 'true', 'on', '1'].includes(v))
    const tasks = await this.all()
    if ('project' in fields) {
      const project = fields.project ? [...tasks.values()].find(t => t.id === fields.project || t.iri === fields.project) : null
      if (fields.project && !project) throw new TaskError('No such project')
      if (project?.iri === next.iri) throw new TaskError('A task cannot be part of itself')
      next.project = project?.iri ?? null
    }
    if ('dependsOn' in fields) {
      const ids = (Array.isArray(fields.dependsOn) ? fields.dependsOn : [fields.dependsOn]).filter(Boolean)
      const deps = ids.map(id => [...tasks.values()].find(t => t.id === id || t.iri === id))
      if (deps.some(d => !d)) throw new TaskError('A dependency is not a known task')
      if (deps.some(d => d.iri === next.iri)) throw new TaskError('A task cannot depend on itself')
      next.dependsOn = [...new Set(deps.map(d => d.iri))]
    }
    return next
  }

  async create (fields, actor) {
    const status = STATES.includes(fields.status) ? fields.status : 'todo'
    const id = newTaskId()
    const base = { id, iri: taskIri(id), title: '', status, created: this.now().toISOString(), dependsOn: [], tags: [], priority: null }
    const task = await this.#apply(base, { priority: 3, ...fields })
    task.position = await this.#place(status)
    if (status === 'done') task.doneAt = task.created
    return this.#write(task, actor, `new task: ${task.title.slice(0, 60)}`)
  }

  async update (task, fields, actor) {
    const next = await this.#apply(task, fields)
    next.modified = this.now().toISOString()
    return this.#write(next, actor, `edit ${Object.keys(fields).join(', ')}`)
  }

  /** Change column and/or place. Refused while dependencies are unfinished. */
  async move (task, { status = task.status, before = null, after = null }, actor) {
    const tasks = await this.all()
    checkTransition(task, status, byIri(tasks.values()))
    const next = { ...task, status, modified: this.now().toISOString() }
    const others = new Map(tasks)
    others.delete(task.id)
    this.tasks = others // place among the others, not itself
    try {
      next.position = await this.#place(status, { before, after })
    } finally {
      this.tasks = tasks
    }
    if (status === 'done' && task.status !== 'done') next.doneAt = next.modified
    if (status !== 'done') next.doneAt = null
    return this.#write(next, actor, `${task.status} → ${status}`)
  }

  async delete (task, actor) {
    const tasks = await this.all()
    for (const other of tasks.values()) {
      if (other.dependsOn.includes(task.iri) || other.project === task.iri) {
        await this.#write({ ...other, dependsOn: other.dependsOn.filter(d => d !== task.iri), project: other.project === task.iri ? null : other.project }, actor, `dropped reference to deleted ${task.id}`)
      }
    }
    await this.repository.deleteResources({ graph: await this.graph(), subjects: [task.iri], actor, summary: `deleted task: ${task.title.slice(0, 60)}` })
    if (this.links) await this.links.forget([task.iri])
    tasks.delete(task.id)
  }

  /** Recent change-log entries for a task. */
  async history (task) {
    const graph = this.repository.registry.constructor.graphIri('system', 'changes')
    return this.client.select(this.queries.get('farelo/history', { graph: iri(graph), resource: iri(task.iri) }))
  }
}

export default TaskStore
