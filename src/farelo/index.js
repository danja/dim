import { registerRoutes } from './api/routes.js'
import { registerAdvisorRoutes } from '../advisor/api/routes.js'
import { taskPath } from './api/common.js'
import { STATES, STATE_LABELS } from './tasks.js'
import { tokenise } from '../common/search/LexicalIndex.js'
import { countTags } from '../common/facets/tags.js'
import { plainText } from '../common/outline/OutlineParser.js'

/**
 * Farelo — tasks on a Kanban board, with Getting Things Diced to pick the
 * next one (docs/plan-detail.md Phase 6). Tasks live in graph:facet/farelo.
 */
/** advisor: the "What next?" Advisor (src/advisor), mounted at /farelo/next. */
export function createFareloFacet ({ store, rolls = null, rng, advisor = null }) {
  if (!store) throw new Error('Farelo needs a TaskStore')
  const label = task => plainText(task.title)
  return {
    id: 'farelo',
    label: 'Farelo',
    description: 'Tasks: a Kanban board, and Getting Things Diced to pick what to do next.',
    types: { task: '/farelo/task/' },

    routes (router, ctx) {
      registerRoutes(router, { store, rolls, rng, ...ctx })
      if (advisor) {
        advisor.registry = ctx.registry
        registerAdvisorRoutes(router, { advisor, ...ctx })
      }
    },

    async health () {
      const tasks = await store.list()
      return { status: 'ok', tasks: tasks.length, ...Object.fromEntries(STATES.map(s => [s, tasks.filter(t => t.status === s).length])) }
    },

    async documents () {
      return (await store.list()).map(t => ({ iri: t.iri, text: [label(t), t.note].filter(Boolean).join('\n\n') }))
    },

    async tags () {
      return countTags((await store.list()).filter(t => t.status !== 'done').map(t => t.tags))
    },

    async tagged (tag) {
      return (await store.list()).filter(t => t.tags?.includes(tag))
        .sort((a, b) => (a.status === 'done') - (b.status === 'done') || label(a).localeCompare(label(b)))
        .map(t => ({ iri: t.iri, label: label(t), href: taskPath(t), snippet: STATE_LABELS[t.status] ?? t.status }))
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
