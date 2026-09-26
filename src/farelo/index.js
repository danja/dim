import { registerRoutes } from './api/routes.js'
import { taskPath } from './api/common.js'
import { STATES } from './tasks.js'
import { tokenise } from '../common/search/LexicalIndex.js'
import { plainText } from '../common/outline/OutlineParser.js'

/**
 * Farelo — tasks on a Kanban board, with Getting Things Diced to pick the
 * next one (docs/plan-detail.md Phase 6). Tasks live in graph:facet/farelo.
 */
export function createFareloFacet ({ store, rolls = null, rng }) {
  if (!store) throw new Error('Farelo needs a TaskStore')
  const label = task => plainText(task.title)
  return {
    id: 'farelo',
    label: 'Farelo',
    description: 'Tasks: a Kanban board, and Getting Things Diced to pick what to do next.',
    types: { task: '/farelo/task/' },

    routes (router, ctx) {
      registerRoutes(router, { store, rolls, rng, ...ctx })
    },

    async health () {
      const tasks = await store.list()
      return { status: 'ok', tasks: tasks.length, ...Object.fromEntries(STATES.map(s => [s, tasks.filter(t => t.status === s).length])) }
    },

    async lookup (resourceIri) {
      const task = (await store.list()).find(t => t.iri === resourceIri)
      return task ? { label: label(task), href: taskPath(task), type: 'task' } : null
    },

    async lookupTitle (title) {
      const wanted = String(title).trim().toLowerCase()
      return (await store.list()).find(t => label(t).toLowerCase() === wanted)?.iri ?? null
    },

    async find (q, { limit = 10 } = {}) {
      const words = tokenise(q)
      if (!words.length) return []
      return (await store.list())
        .filter(t => words.every(w => `${label(t)} ${t.note ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(w)))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done'))
        .slice(0, limit)
        .map(t => ({ iri: t.iri, label: label(t), href: taskPath(t), snippet: t.status }))
    }
  }
}

export default createFareloFacet
