import { describe, it, expect } from 'vitest'
import { TARGETS, probability, roll, diceList, pick, nextState, seeded } from '../../src/farelo/dice.js'
import { rankForDice, checkTransition, columns, byIri, comparePriority } from '../../src/farelo/tasks.js'

const task = (id, extra = {}) => ({ id, iri: `urn:${id}`, title: id, status: 'todo', priority: 3, created: `2026-01-${String(id.length).padStart(2, '0')}`, position: 1, dependsOn: [], ...extra })

describe('the Getting Things Diced table (plan 6.1)', () => {
  it('maps priorities 1–11 to the two-dice sums, likeliest first', () => {
    expect(TARGETS).toEqual([7, 6, 8, 5, 9, 4, 10, 3, 11, 2, 12])
    const chances = TARGETS.map(probability)
    expect(chances.map(c => Math.round(c * 36))).toEqual([6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1])
    for (let i = 1; i < chances.length; i++) expect(chances[i]).toBeLessThanOrEqual(chances[i - 1])
    expect(chances.reduce((a, b) => a + b)).toBeCloseTo(1)
  })

  it('numbers at most eleven tasks', () => {
    const list = diceList(Array.from({ length: 14 }, (_, i) => task(`t${i}`)))
    expect(list).toHaveLength(11)
    expect(list[0]).toMatchObject({ rank: 1, target: 7 })
    expect(list[10]).toMatchObject({ rank: 11, target: 12 })
  })

  it('picks with the 2d6 distribution: 36,000 seeded rolls within 1%', () => {
    const list = diceList(Array.from({ length: 11 }, (_, i) => task(`t${i}`)))
    const rng = seeded(42)
    const counts = new Map()
    const N = 36000
    for (let i = 0; i < N; i++) {
      const { entry } = pick(list, rng)
      counts.set(entry.rank, (counts.get(entry.rank) ?? 0) + 1)
    }
    for (const entry of list) {
      expect(Math.abs(counts.get(entry.rank) / N - entry.chance), `rank ${entry.rank}`).toBeLessThan(0.01)
    }
  })

  it('re-rolls sums that hit an empty or skipped target', () => {
    const list = diceList([task('a'), task('b')]) // targets 7 and 6 only
    const rng = seeded(7)
    for (let i = 0; i < 200; i++) expect([7, 6]).toContain(pick(list, rng).sum)
    const onlySix = pick(list, rng, { skipTargets: [7] })
    expect(onlySix.entry.task.id).toBe('b')
    expect(pick(list, rng, { skipTargets: [6, 7] })).toBeNull()
    expect(pick([], rng)).toBeNull()
  })

  it('rolls fair dice', () => {
    const rng = seeded(1)
    for (let i = 0; i < 100; i++) {
      const { dice, sum } = roll(rng)
      expect(dice.every(d => d >= 1 && d <= 6)).toBe(true)
      expect(sum).toBe(dice[0] + dice[1])
    }
  })

  it('applies each after-pick policy', () => {
    const picked = { target: 7, task: { id: 'a' } }
    expect(nextState({ exclude: ['x'], skip: [6] }, picked, 'replace')).toEqual({ exclude: ['x', 'a'], skip: [] })
    expect(nextState({ exclude: ['x'], skip: [6] }, picked, 'skip')).toEqual({ exclude: ['x'], skip: [6, 7] })
    expect(nextState({ exclude: ['x'], skip: [6] }, picked, 'new')).toEqual({ exclude: [], skip: [] })
    expect(() => nextState({}, picked, 'nope')).toThrow(/Unknown policy/)
    // replace: the next unnumbered task moves up into the list
    const tasks = Array.from({ length: 12 }, (_, i) => task(`t${String(i).padStart(2, '0')}`, { priority: 1 + Math.floor(i / 3) }))
    const first = diceList(rankForDice(tasks))
    const state = nextState({}, first[0], 'replace')
    const second = diceList(rankForDice(tasks, state))
    expect(second.map(e => e.task.id)).not.toContain(first[0].task.id)
    expect(second.at(-1).task.id).toBe('t11')
  })
})

describe('task rules', () => {
  const a = task('a', { status: 'done' })
  const b = task('b', { dependsOn: ['urn:a'] })
  const c = task('c', { dependsOn: ['urn:b'] })
  const d = task('d', { status: 'blocked' })
  const e = task('e', { status: 'backlog' })
  const f = task('f', { isProject: true })
  const all = [a, b, c, d, e, f]

  it('never offers blocked, waiting, backlog, done or project tasks to the dice', () => {
    expect(rankForDice(all).map(t => t.id)).toEqual(['b'])
  })

  it('refuses to start or finish a task that waits on another', () => {
    const index = byIri(all)
    expect(() => checkTransition(c, 'doing', index)).toThrow(/waits on: b/)
    expect(() => checkTransition(c, 'done', index)).toThrow(/waits on/)
    expect(() => checkTransition(c, 'blocked', index)).not.toThrow()
    expect(() => checkTransition(b, 'doing', index)).not.toThrow()
    expect(() => checkTransition(b, 'sideways', index)).toThrow(/Unknown state/)
  })

  it('ranks by priority, then due date, then age', () => {
    const x = task('x', { priority: 2 })
    const y = task('y', { priority: 2, due: '2026-10-01' })
    const z = task('zz', { priority: 1 })
    expect([x, y, z].sort(comparePriority).map(t => t.id)).toEqual(['zz', 'y', 'x'])
  })

  it('groups the board into columns, filtered by project', () => {
    const p = task('p', { isProject: true, status: 'doing' })
    const q = task('q', { project: 'urn:p', position: 2 })
    const r = task('r', { project: 'urn:p', position: 1 })
    const cols = columns([p, q, r, task('s')], { project: 'urn:p' })
    expect(cols.todo.map(t => t.id)).toEqual(['r', 'q'])
    expect(cols.doing.map(t => t.id)).toEqual(['p'])
  })
})
