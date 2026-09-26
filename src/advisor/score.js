import { byIri, eligibleForDice, pendingDependencies, comparePriority, DEFAULT_PRIORITY } from '../farelo/tasks.js'

/**
 * "What next?" — scoring v1. Pure and deterministic: the same tasks,
 * context, feedback and clock give the same list, and every suggestion
 * carries the reasons for its score.
 *
 * score = Σ weight[f] × feature[f], features in [-1, 1]:
 *
 *   priority   1 (highest) → 1 … 5 → 0.2
 *   due        overdue or today → 1, fading to 0 two weeks out
 *   underway   already Doing: finish what you started
 *   fits       the estimate fits the time you have (-1 if it doesn't)
 *   context    tagged with your @context (-1 if tagged for another)
 *   unblocks   other tasks wait on it
 *   ready      it has linked resources (bookmarks, pages, …)
 *   age        waiting a long time (so nothing starves)
 *   skipped    you passed on it lately (-1 fading over ~3 days)
 */

export const FEATURES = Object.freeze(['priority', 'due', 'underway', 'fits', 'context', 'unblocks', 'ready', 'age', 'skipped'])
export const DEFAULT_WEIGHTS = Object.freeze({ priority: 3, due: 3, underway: 1.5, fits: 2, context: 1, unblocks: 1.5, ready: 0.5, age: 0.5, skipped: 2 })
export const WEIGHT_RANGE = Object.freeze([0.1, 6])
export const CLOSE_CALL = 0.05 // top two within 5%: offer the dice

const DAY = 86400000
const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x))
const round = x => (Math.round(x * 1000) / 1000) || 0 // no -0

function daysUntil (date, now) {
  return Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY)
}

/**
 * The feature values for one task, and why.
 * ctx: { now, minutes, context, index, waitingOn: Map iri→count, resources: Map iri→count, skips: Map iri→[iso] }
 */
export function features (task, ctx) {
  const f = {}
  const why = {}
  const p = task.priority ?? DEFAULT_PRIORITY
  f.priority = (6 - p) / 5
  why.priority = `priority ${p}`

  if (task.due) {
    const d = daysUntil(task.due, ctx.now)
    f.due = d <= 0 ? 1 : clamp(1 - d / 14, 0, 1)
    why.due = d < 0 ? `overdue by ${-d} day${d === -1 ? '' : 's'}` : d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`
  } else f.due = 0

  f.underway = task.status === 'doing' ? 1 : 0
  if (f.underway) why.underway = 'already under way'

  if (ctx.minutes && task.estimate) {
    f.fits = task.estimate <= ctx.minutes ? 1 : -1
    why.fits = f.fits > 0 ? `fits your ${ctx.minutes} min (~${task.estimate} min)` : `needs ~${task.estimate} min, more than ${ctx.minutes}`
  } else f.fits = 0

  const tagged = (task.tags ?? []).filter(t => t.startsWith('@'))
  if (ctx.context && tagged.length) {
    f.context = tagged.includes(ctx.context) ? 1 : -1
    why.context = f.context > 0 ? `for ${ctx.context}` : `for ${tagged.join(', ')}, not ${ctx.context}`
  } else f.context = 0

  const waiting = ctx.waitingOn?.get(task.iri) ?? 0
  f.unblocks = clamp(waiting / 3, 0, 1)
  if (waiting) why.unblocks = `${waiting} task${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} on it`

  const linked = ctx.resources?.get(task.iri) ?? 0
  f.ready = linked ? 1 : 0
  if (linked) why.ready = `${linked} linked resource${linked === 1 ? '' : 's'}`

  const ageDays = task.created ? (ctx.now - Date.parse(task.created)) / DAY : 0
  f.age = clamp(ageDays / 60, 0, 1)
  if (ageDays >= 30) why.age = `waiting ${Math.floor(ageDays)} days`

  const skips = (ctx.skips?.get(task.iri) ?? []).map(at => (ctx.now - Date.parse(at)) / DAY).filter(d => d >= 0 && d < 14)
  f.skipped = -clamp(skips.reduce((s, d) => s + Math.exp(-d / 3), 0), 0, 1)
  if (skips.length) why.skipped = `skipped ${skips.length}× lately`

  for (const k of FEATURES) f[k] = round(f[k] ?? 0)
  return { values: f, why }
}

export function scoreOf (values, weights) {
  return round(FEATURES.reduce((s, k) => s + (weights[k] ?? 0) * values[k], 0))
}

/**
 * Eligible tasks (To do / Doing, not projects, dependencies done), best
 * first. → [{ task, score, values, reasons: [{ feature, text, points }] }]
 */
export function rank (tasks, { weights = DEFAULT_WEIGHTS, now = new Date(), minutes = null, context = null, resources = new Map(), skips = new Map() } = {}) {
  const index = byIri(tasks)
  const waitingOn = new Map()
  for (const t of tasks) {
    if (t.status === 'done') continue
    for (const dep of pendingDependencies(t, index)) waitingOn.set(dep, (waitingOn.get(dep) ?? 0) + 1)
  }
  const ctx = { now, minutes, context, index, waitingOn, resources, skips }
  return tasks.filter(t => eligibleForDice(t, index)).map(task => {
    const { values, why } = features(task, ctx)
    const reasons = FEATURES
      .map(k => ({ feature: k, text: why[k], points: round((weights[k] ?? 0) * values[k]) }))
      .filter(r => r.text && r.points !== 0)
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    return { task, score: scoreOf(values, weights), values, reasons }
  }).sort((a, b) => (b.score - a.score) || comparePriority(a.task, b.task))
}

/** The top two are within CLOSE_CALL of each other. */
export function isCloseCall (ranked) {
  if (ranked.length < 2) return false
  const [a, b] = ranked
  return Math.abs(a.score - b.score) <= CLOSE_CALL * Math.max(Math.abs(a.score), 1e-9)
}

/**
 * Learning from a choice: the accepted suggestion should have outscored
 * each one shown above it, so move the weights toward the features where
 * it was stronger (a perceptron step), within WEIGHT_RANGE.
 */
export function learn (weights, accepted, above, { rate = 0.1 } = {}) {
  const next = { ...weights }
  for (const other of above) {
    for (const k of FEATURES) next[k] = (next[k] ?? 0) + rate * (accepted.values[k] - other.values[k])
  }
  for (const k of FEATURES) next[k] = round(Math.min(WEIGHT_RANGE[1], Math.max(WEIGHT_RANGE[0], next[k])))
  return next
}
