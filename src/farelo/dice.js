/**
 * Getting Things Diced (docs/plan-detail.md 6.1; Danny Ayers, hyperdata.it,
 * 2015-05-11). Pure functions: the random source is injected, so a seeded
 * generator makes rolls reproducible in tests.
 *
 * Up to eleven tasks, in priority order, are given the two-dice sums as
 * targets — the likeliest sum (7) to priority 1, then alternating either
 * side of 7 — so a roll picks higher-priority work more often, but not
 * always.
 */

export const TARGETS = Object.freeze([7, 6, 8, 5, 9, 4, 10, 3, 11, 2, 12])
export const LIST_SIZE = TARGETS.length
export const POLICIES = Object.freeze(['replace', 'skip', 'new'])

/** Chance of rolling `sum` with two fair dice. */
export function probability (sum) {
  return sum >= 2 && sum <= 12 ? (6 - Math.abs(7 - sum)) / 36 : 0
}

/** One die, 1–6, from a source of [0, 1) numbers. */
export function die (rng) {
  return 1 + Math.floor(rng() * 6)
}

export function roll (rng) {
  const dice = [die(rng), die(rng)]
  return { dice, sum: dice[0] + dice[1] }
}

/**
 * The numbered list: the first eleven of `ranked` (already eligible and in
 * priority order), each with its rank, target and chance.
 */
export function diceList (ranked) {
  return ranked.slice(0, LIST_SIZE).map((task, i) => ({
    rank: i + 1,
    target: TARGETS[i],
    chance: probability(TARGETS[i]),
    task
  }))
}

/**
 * Roll until the sum hits a numbered, not-skipped target. → { dice, sum,
 * entry, rolls } or null when nothing can be hit. `maxRolls` guards
 * against a pathological generator, not against bad luck.
 */
export function pick (list, rng, { skipTargets = [], maxRolls = 1000 } = {}) {
  const skip = new Set(skipTargets)
  const live = new Map(list.filter(e => !skip.has(e.target)).map(e => [e.target, e]))
  if (live.size === 0) return null
  for (let rolls = 1; rolls <= maxRolls; rolls++) {
    const r = roll(rng)
    const entry = live.get(r.sum)
    if (entry) return { ...r, entry, rolls }
  }
  return null
}

/**
 * State for the next roll after a pick, per policy:
 *   replace — the picked task leaves the list; the next unnumbered task
 *             moves up to fill it
 *   skip    — keep the list, but ignore the picked target next time
 *   new     — start again from the full list
 */
export function nextState ({ exclude = [], skip = [] }, picked, policy) {
  switch (policy) {
    case 'replace': return { exclude: [...new Set([...exclude, picked.task.id])], skip: [] }
    case 'skip': return { exclude, skip: [...new Set([...skip, picked.target])] }
    case 'new': return { exclude: [], skip: [] }
    default: throw new Error(`Unknown policy ${JSON.stringify(policy)}; use ${POLICIES.join(', ')}`)
  }
}

/** A small seeded generator (mulberry32), for tests and reproducible rolls. */
export function seeded (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
