/** A fixed set of tasks and a fixed "now" for the advisor tests. */
export const NOW = new Date('2026-09-26T09:00:00Z')
const T = 'http://purl.org/stuff/dim/task/'
const task = (id, fields) => ({ id, iri: T + id, title: id, status: 'todo', priority: 3, due: null, estimate: null, created: '2026-09-20T00:00:00Z', dependsOn: [], tags: [], isProject: false, ...fields })

export function fixtureTasks () {
  return [
    task('tax', { title: 'File the tax return', priority: 1, due: '2026-09-28', estimate: 90, tags: ['@desk'] }),
    task('vco', { title: 'Finish the VCO', status: 'doing', priority: 2, estimate: 45, tags: ['@bench'] }),
    task('glue', { title: 'Buy glue', priority: 4, estimate: 10, tags: ['@town'] }),
    task('case', { title: 'Build the case', priority: 3, dependsOn: [T + 'vco'] }),
    task('knobs', { title: 'Order knobs', priority: 3, dependsOn: [T + 'vco'] }),
    task('old', { title: 'Tidy the shed', priority: 3, created: '2026-06-01T00:00:00Z' }),
    task('someday', { title: 'Learn the banjo', status: 'backlog', priority: 1 }),
    task('proj', { title: 'Synth project', isProject: true, priority: 1 }),
    task('done', { title: 'Old job', status: 'done' })
  ]
}

/** In-memory stand-ins for the TaskStore and AdviceStore. */
export function memoryAdvisorStores (tasks = fixtureTasks()) {
  const records = []
  let weights = null
  const moved = []
  const taskStore = {
    async list () { return tasks },
    async get (id) { return tasks.find(t => t.id === id) ?? null },
    async move (t, { status }) { moved.push([t.id, status]); t.status = status; return t }
  }
  const advice = {
    records,
    async weights () { const { DEFAULT_WEIGHTS } = await import('../../src/advisor/score.js'); return weights ?? { ...DEFAULT_WEIGHTS } },
    async saveWeights (w) { weights = w },
    async skips () {
      const out = new Map()
      for (const r of records.filter(r => r.action === 'skip')) out.set(r.task, [...(out.get(r.task) ?? []), r.at])
      return out
    },
    async record (r) { records.push({ ...r, at: NOW.toISOString() }) },
    async resourceCounts () { return new Map([[T + 'tax', 2]]) }
  }
  return { tasks, taskStore, advice, moved, getWeights: () => weights }
}
